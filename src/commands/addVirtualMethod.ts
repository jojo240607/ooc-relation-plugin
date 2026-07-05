import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';
import { AddMethodPanel } from '../panels/AddMethodPanel';
import { ClassQueryHelper } from '../sync/ClassQueryHelper';

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

    const headerDoc = await vscode.workspace.openTextDocument(headerUri);
    const structInfo = ast.findStruct(headerDoc, className);
    if (!structInfo) {
        vscode.window.showErrorMessage(`Struct ${className} not found.`);
        return;
    }

    const inheritedMethods = await ClassQueryHelper.getAllVirtualMethods(className);
    const currentMethods = ast.hasVtableStruct(headerDoc, className)
        ? ast.getVirtualMethods(headerDoc, className)
        : [];

    AddMethodPanel.createOrShow(
        context.extensionUri,
        className,
        headerUri,
        sourceUri,
        inheritedMethods,
        currentMethods,
        // 回调：当面板提交方法后，更新视图（操作函数已更新缓存）
        (clsName, relativePath, parent, hasVtable) => {
            // 可在此处刷新视图等，但缓存已在 addVirtualMethods 中更新
        }
    );
}