import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';
import { relationStore } from '../sync/ClassRelationStore';
import { syncService } from '../sync/ClassSyncService';
import { propagateVtableChange } from '../repair/propagateVtableChange';

// ========== 内部辅助 ==========

interface ChainItem {
    className: string;
    headerUri: vscode.Uri;
    hasVtable: boolean;
}

async function getParentHeaderUri(parentName: string): Promise<vscode.Uri | null> {
    const parentEntry = relationStore.getClass(parentName);
    if (parentEntry) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (root) {
            return vscode.Uri.joinPath(root, parentEntry.file);
        }
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceFolder) {
        const candidate = vscode.Uri.joinPath(workspaceFolder, `${parentName}.h`);
        try {
            await vscode.workspace.fs.stat(candidate);
            return candidate;
        } catch { /* ignore */ }
    }
    return null;
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

// ========== 公开操作 ==========

/**
 * 为指定类动态添加虚表（头文件 + 源文件修改），不添加具体虚函数
 */
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

        let vtableDef = '';
        if (ancestor) {
            vtableDef = `struct ${className}Vtable {\n    struct ${ancestor.className}Vtable parent;\n    \n};\n`;
        } else {
            vtableDef = `struct ${className}Vtable {\n    \n};\n`;
        }
        await ast.insertBeforeStruct(headerDoc, className, vtableDef);

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
        const updatedHeaderDoc = await vscode.workspace.openTextDocument(headerUri);
        await updatedHeaderDoc.save();
        const updatedSourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await updatedSourceDoc.save();
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

/**
 * 向已有虚表的类批量添加虚函数（头文件声明、源文件默认实现、虚表赋值），不处理虚表创建
 */
export async function addVirtualMethodsToClass(
    className: string,
    headerUri: vscode.Uri,
    methods: { returnType: string; name: string; params: string }[]
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);
        const headerDoc = await vscode.workspace.openTextDocument(headerUri);
        const vtableName = `${className}Vtable`;

        for (const m of methods) {
            const selfParam = `${className} *self`;
            const fullParams = m.params ? `${selfParam}, ${m.params}` : selfParam;
            const funcPtrDecl = `${m.returnType} (*${m.name})(${fullParams});`;

            await ast.insertStructMember(headerDoc, vtableName, funcPtrDecl);

            const defaultFuncName = `default_${className}_${m.name}_impl`;
            let sourceDoc = await vscode.workspace.openTextDocument(sourceUri);

            const decl = `static ${m.returnType} ${defaultFuncName}(${fullParams});`;
            if (!sourceDoc.getText().includes(decl)) {
                await ast.insertAfterIncludes(sourceDoc, decl);
            }

            const defaultReturn = m.returnType === 'void' ? '' : `static ${m.returnType} ret = {0}; return ret;`;
            const defaultImpl = `\nstatic ${m.returnType} ${defaultFuncName}(${fullParams}) {\n    /* TODO: Implement */\n    (void)self;\n    ${defaultReturn}\n}\n`;
            sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            await ast.insertAtEndOfFile(sourceDoc, defaultImpl);

            const vtableAssign = `self->vtable->${m.name} = ${defaultFuncName};`;
            sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            await ast.insertBeforeFunctionEnd(sourceDoc, `${className}_init`, vtableAssign);
        }

        const finalHeaderDoc = await vscode.workspace.openTextDocument(headerUri);
        await finalHeaderDoc.save();
        const finalSourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await finalSourceDoc.save();

        return { success: true, message: `${methods.length} virtual method(s) added to ${className}.` };
    } catch (err: any) {
        return { success: false, message: `Error adding virtual methods: ${err.message}` };
    }
}

/**
 * 统一添加虚函数：自动检查并创建虚表，批量插入方法，更新缓存和传播变化
 */
export async function addVirtualMethods(
    className: string,
    headerUri: vscode.Uri,
    methods: { returnType: string; name: string; params: string }[]
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);
        const headerDoc = await vscode.workspace.openTextDocument(headerUri);
        const classStruct = ast.findStruct(headerDoc, className);
        if (!classStruct) return { success: false, message: `Struct ${className} not found.` };

        const parentName = ast.getParentClassName(classStruct, headerDoc);
        const needsVtable = !ast.hasVtableStruct(headerDoc, className);

        if (needsVtable) {
            const success = await addVtableToClass(headerUri, sourceUri, className);
            if (!success) return { success: false, message: `Failed to add virtual table.` };
        }

        const result = await addVirtualMethodsToClass(className, headerUri, methods);
        if (!result.success) return result;

        const relativePath = vscode.workspace.asRelativePath(headerUri);
        await syncService.registerClass(className, relativePath, parentName, true);

        if (needsVtable) {
            await propagateVtableChange(className);
        }

        return { success: true, message: result.message };
    } catch (err: any) {
        return { success: false, message: `Error adding virtual methods: ${err.message}` };
    }
}