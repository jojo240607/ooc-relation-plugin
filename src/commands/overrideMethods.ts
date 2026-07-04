import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';
import { OverrideMethodPanel } from '../panels/OverrideMethodPanel';
import { syncService } from '../sync/ClassSyncService';
import { relationStore } from '../sync/ClassRelationStore';

export interface AncestorMethod {
    returnType: string;
    name: string;
    params: string;
    fromClass: string;
    vtablePath: string;   // e.g. "parent.vtable" or "parent.parent.vtable"
}

/**
 * 优先从关系表中获取父类的头文件 URI，若不存在则回退到文件系统查找。
 */
async function getParentHeaderUri(parentName: string): Promise<vscode.Uri | null> {
    const parentEntry = relationStore.getClass(parentName);
    if (parentEntry) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (root) {
            return vscode.Uri.joinPath(root, parentEntry.file);
        }
    }

    // 回退：尝试在本地查找（如果父类尚未被插件记录）
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceFolder) {
        const candidate = vscode.Uri.joinPath(workspaceFolder, `${parentName}.h`);
        try {
            await vscode.workspace.fs.stat(candidate);
            return candidate;
        } catch {
            //return await ast.findHeaderUri(parentName, workspaceFolder);
        }
    }
    return null;
}

export async function overrideMethods(context: vscode.ExtensionContext, headerUri: vscode.Uri) {
    const childName = headerUri.path.split('/').pop()?.replace('.h', '') || 'Unknown';
    const dirUri = vscode.Uri.joinPath(headerUri, '..');
    const sourceUri = vscode.Uri.joinPath(dirUri, `${childName}.c`);

    try { await vscode.workspace.fs.stat(sourceUri); } catch {
        vscode.window.showErrorMessage(`Source file ${childName}.c not found.`);
        return;
    }

    const childDoc = await vscode.workspace.openTextDocument(headerUri);
    const childStruct = ast.findStruct(childDoc, childName);
    if (!childStruct) {//|| !ast.hasVtableField(childStruct)
        vscode.window.showErrorMessage(`Class ${childName} does not be found`);
        return;
    }

    // ===== 收集所有祖先的虚方法 =====
    const allAncestorMethods: AncestorMethod[] = [];
    const visited = new Set<string>();
    visited.add(childName);
    const parentChain: string[] = [];
    let currentParentName = ast.getParentClassName(childStruct, childDoc);

    while (currentParentName && !visited.has(currentParentName)) {
        const parentUri = await getParentHeaderUri(currentParentName);
        if (!parentUri) break;

        const parentDoc = await vscode.workspace.openTextDocument(parentUri);
        const parentStruct = ast.findStruct(parentDoc, currentParentName);
        if (!parentStruct) break;

        parentChain.push(currentParentName);
        const hasVtable = ast.hasVtableField(parentStruct);

        if (hasVtable) {
            const methods = ast.getVirtualMethods(parentDoc, currentParentName);
            const depth = parentChain.length;
            const vtablePath = Array(depth).fill('parent').join('.') + '.vtable';
            for (const m of methods) {
                allAncestorMethods.push({
                    returnType: m.returnType,
                    name: m.name,
                    params: m.params,
                    fromClass: currentParentName,
                    vtablePath
                });
            }
        }

        const grandParent = ast.getParentClassName(parentStruct, parentDoc);
        visited.add(currentParentName);
        currentParentName = grandParent;
    }

    if (allAncestorMethods.length === 0) {
        vscode.window.showInformationMessage('No virtual methods found in any ancestor class.');
        return;
    }

    // ===== 检查已覆写的方法 =====
    const alreadyOverridden = new Set<string>();
    try {
        const sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        const sourceText = sourceDoc.getText();
        const overrideRegex = new RegExp(`override_${childName}_(\\w+)_(\\w+)_impl`, 'g');
        let match;
        while ((match = overrideRegex.exec(sourceText)) !== null) {
            const parentClass = match[1];
            const methodName = match[2];
            alreadyOverridden.add(`${methodName}::${parentClass}`);
        }
    } catch {}

    // 获取当前类的父类和虚表状态（用于同步缓存）
    const parentName = ast.getParentClassName(childStruct, childDoc);
    const hasVtable = true; // 已经通过 hasVtableField 检查

    OverrideMethodPanel.createOrShow(
        context.extensionUri,
        childName,
        headerUri,
        sourceUri,
        allAncestorMethods,
        alreadyOverridden,
        // 成功覆盖后的回调：更新关系表
        (clsName: string, relativePath: string) => {
            syncService.registerClass(clsName, relativePath, parentName, hasVtable);
        }
    );
}