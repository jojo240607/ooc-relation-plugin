import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';
import { AddMethodPanel } from '../panels/AddMethodPanel';
import { propagateVtableChange } from '../repair/propagateVtableChange';
import { ClassQueryHelper } from '../sync/ClassQueryHelper';
import { syncService } from '../sync/ClassSyncService';
import { relationStore } from '../sync/ClassRelationStore';

export interface AncestorVirtualMethod {
    returnType: string;
    name: string;
    params: string;
    fromClass: string;
}

export async function addVirtualMethod(context: vscode.ExtensionContext, headerUri: vscode.Uri) {
    const className = headerUri.path.split('/').pop()?.replace('.h', '') || 'Unknown';
    const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);

    try { await vscode.workspace.fs.stat(sourceUri); } catch {
        vscode.window.showErrorMessage(`Source file ${className}.c not found.`);
        return;
    }

    // 解析当前头文件，获取父类和虚表状态
    const headerDoc = await vscode.workspace.openTextDocument(headerUri);
    const structInfo = ast.findStruct(headerDoc, className);
    if (!structInfo) {
        vscode.window.showErrorMessage(`Struct ${className} not found.`);
        return;
    }
    const parentName = ast.getParentClassName(structInfo, headerDoc);
    const needsVtable = !ast.hasVtableStruct(headerDoc, className);

    // 收集祖先虚函数（基于 relationStore 的查询工具）
    const inheritedMethods = await ClassQueryHelper.getAllVirtualMethods(className);

    // 重新解析当前头文件，获取最新的虚函数列表（可能刚添加了虚表）
    const updatedHeaderDoc = await vscode.workspace.openTextDocument(headerUri);
    const currentMethods = ast.hasVtableStruct(updatedHeaderDoc, className)
        ? ast.getVirtualMethods(updatedHeaderDoc, className)
        : [];
    // 构建虚表添加回调（但不立即执行）
    const addVtableCallback = async (): Promise<boolean> => {
        const success = await addVtableToClass(headerUri, sourceUri, className);
        if (!success) return false;

        // 更新当前类到关系表（hasVtable = true）
        const relativePath = vscode.workspace.asRelativePath(headerUri);
        await syncService.registerClass(className, relativePath, parentName, true);

        // 传播虚表变化
        await propagateVtableChange(className);
        return true;
    };
    // 打开添加方法面板，并传入回调：面板完成添加后，将当前类注册到同步服务
    AddMethodPanel.createOrShow(
        context.extensionUri,
        className,
        headerUri,
        sourceUri,
        inheritedMethods,
        currentMethods,
        needsVtable,          // 新增
        addVtableCallback,    // 新增：面板提交时才调用
        (clsName, relativePath, parent, hasVtable) => {
            syncService.registerClass(clsName, relativePath, parent, hasVtable);
        }
    );
}

// ========== 动态添加虚表 ==========
export async function addVtableToClass(
    headerUri: vscode.Uri,
    sourceUri: vscode.Uri,
    className: string
): Promise<boolean> {
    try {
        const headerDoc = await vscode.workspace.openTextDocument(headerUri);
        const structInfo = ast.findStruct(headerDoc, className);
        if (!structInfo) return false;

        const parentChain = await getAncestorChain(headerUri, className);
        const isBaseClass = parentChain.length === 0;
        const ancestor = findFirstVtableAncestor(parentChain);

        // 为链中的根类插入占位符（如果还没有任何 vtable 字段）
        for (const item of parentChain) {
            if (!item.hasVtable) {
                const itemDoc = await vscode.workspace.openTextDocument(item.headerUri);
                const itemStruct = ast.findStruct(itemDoc, item.className);
                if (itemStruct) {
                    const itemParent = ast.getParentClassName(itemStruct, itemDoc);
                    if (!itemParent) {
                        await ensurePlaceholderInClass(item.headerUri, item.className);
                    }
                }
            }
        }

        const edit = new vscode.WorkspaceEdit();

        // 处理 vtable 指针：如果已有占位符，替换为真正指针；否则插入/替换
        if (ast.hasVtableField(structInfo)) {
            await replacePlaceholderWithVtable(headerDoc, structInfo, className);
        } else {
            if (isBaseClass) {
                await ast.insertBeforeFirstMember(headerDoc, structInfo, `struct ${className}Vtable *vtable;`);
            } else {
                const directParent = parentChain[0].className;
                const unionDef = `union { ${directParent} parent; struct ${className}Vtable *vtable; };`;
                await ast.replaceFirstMember(headerDoc, structInfo, unionDef);
            }
        }

        // 插入虚表结构体定义（在类定义之前）
        let vtableDef = '';
        if (ancestor) {
            vtableDef = `struct ${className}Vtable {\n    struct ${ancestor.className}Vtable parent;\n    \n};\n`;
        } else {
            vtableDef = `struct ${className}Vtable {\n    \n};\n`;
        }
        await ast.insertBeforeStruct(headerDoc, className, vtableDef);

        // 源文件：分配代码
        let sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        let sourceText = sourceDoc.getText();

        const initFuncName = `${className}_init`;
        const allocCode = `
    /* OOC vtable allocation */
    if (!self->vtable) {
        self->vtable = (struct ${className}Vtable*)malloc(sizeof(struct ${className}Vtable));
        if (self->vtable) {
            memset(self->vtable, 0, sizeof(struct ${className}Vtable));
        }
    }
`;
        const initFunc = ast.findFunction(sourceDoc, initFuncName);
        if (initFunc) {
            const insertPos = new vscode.Position(initFunc.bodyStart + 1, 0);
            edit.insert(sourceUri, insertPos, allocCode);
        }

        const deinitFuncName = `${className}_deinit`;
        const deinitFunc = ast.findFunction(sourceDoc, deinitFuncName);
        if (deinitFunc && !sourceText.includes('free(self->vtable)')) {
            const freeCode = `    if (self->vtable) {\n        free(self->vtable);\n        self->vtable = NULL;\n    }\n`;
            const insertPos = new vscode.Position(deinitFunc.bodyEnd, 0);
            edit.insert(sourceUri, insertPos, freeCode);
        }

        await vscode.workspace.applyEdit(edit);
        // 保存修改的文件
        const updatedHeaderDoc = await vscode.workspace.openTextDocument(headerUri);
        await updatedHeaderDoc.save();
        const updatedSourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await updatedSourceDoc.save();
        return true;
    } catch (err) {
        console.error(err);
        vscode.window.showErrorMessage(`Error adding vtable: ${err}`);
        return false;
    }
}

/**
 * 将占位符 _vtable 替换为具体的虚表指针
 */
async function replacePlaceholderWithVtable(
    document: vscode.TextDocument,
    structInfo: ast.StructInfo,
    className: string
): Promise<void> {
    const placeholderMember = structInfo.members.find(m => m.name === '_vtable');
    if (!placeholderMember) return;
    const line = placeholderMember.line;
    const oldLine = document.lineAt(line).text;
    const indentMatch = oldLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[0] : '    ';
    const newLine = `${indent}struct ${className}Vtable *vtable;`;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(line, 0, line, oldLine.length), newLine);
    await vscode.workspace.applyEdit(edit);
}

// ========== 继承链（本地解析，不再依赖 classInfoCache） ==========
interface ChainItem {
    className: string;
    headerUri: vscode.Uri;
    hasVtable: boolean;
}

async function getAncestorChain(startUri: vscode.Uri, startClass: string): Promise<ChainItem[]> {
    const chain: ChainItem[] = [];
    let currentUri = startUri;
    let currentClass = startClass;
    const visited = new Set<string>();
    visited.add(currentClass);

    while (true) {
        const doc = await vscode.workspace.openTextDocument(currentUri);
        const structInfo = ast.findStruct(doc, currentClass);
        if (!structInfo) break;
        const parentName = ast.getParentClassName(structInfo, doc);
        if (!parentName || visited.has(parentName)) break;
        visited.add(parentName);

        const parentUri = await getParentHeaderUri(parentName);
        if (!parentUri) break;

        const parentDoc = await vscode.workspace.openTextDocument(parentUri);
        const parentStruct = ast.findStruct(parentDoc, parentName);
        const hasVtable = parentStruct ? ast.hasVtableStruct(parentDoc, parentName) : false;

        chain.push({ className: parentName, headerUri: parentUri, hasVtable });

        currentUri = parentUri;
        currentClass = parentName;
    }
    return chain;
}

function findFirstVtableAncestor(chain: ChainItem[]): { className: string } | null {
    for (const item of chain) {
        if (item.hasVtable) return { className: item.className };
    }
    return null;
}

async function ensurePlaceholderInClass(headerUri: vscode.Uri, className: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(headerUri);
    const struct = ast.findStruct(doc, className);
    if (!struct || ast.hasVtableField(struct)) return;
    const placeholder = `const void *_vtable;  /* placeholder for subclass vtable */`;
    await ast.insertBeforeFirstMember(doc, struct, placeholder);
    const savedDoc = await vscode.workspace.openTextDocument(headerUri);
    await savedDoc.save();
}

/**
 * 优先从关系表中获取父类的头文件 URI，
 * 如果不存在，则回退到文件系统查找。
 */
async function getParentHeaderUri(parentName: string): Promise<vscode.Uri | null> {
    const parentEntry = relationStore.getClass(parentName);
    if (parentEntry) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (root) {
            return vscode.Uri.joinPath(root, parentEntry.file);
        }
    }

    // 回退：在头文件所在目录查找
    // 注意：此时没有 currentUri 上下文，可以先用工作区根目录作为起点
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceFolder) {
        // 优先尝试同名文件
        const candidate = vscode.Uri.joinPath(workspaceFolder, `${parentName}.h`);
        try {
            await vscode.workspace.fs.stat(candidate);
            return candidate;
        } catch {
            // 如果找不到，调用 ast.findHeaderUri 全局搜索
            //return await ast.findHeaderUri(parentName, workspaceFolder);
        }
    }
    return null;
}