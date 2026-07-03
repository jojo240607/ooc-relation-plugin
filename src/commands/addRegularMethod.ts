import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';
import { AddRegularMethodPanel } from '../panels/AddRegularMethodPanel';
import { syncService } from '../sync/ClassSyncService';

export async function addRegularMethod(context: vscode.ExtensionContext, headerUri: vscode.Uri) {
    const className = headerUri.path.split('/').pop()?.replace('.h', '') || 'Unknown';
    const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);

    try { await vscode.workspace.fs.stat(sourceUri); } catch {
        vscode.window.showErrorMessage(`Source file ${className}.c not found.`);
        return;
    }

    const headerDoc = await vscode.workspace.openTextDocument(headerUri);
    const classStruct = ast.findStruct(headerDoc, className);
    if (!classStruct) {
        vscode.window.showErrorMessage(`Struct ${className} not found.`);
        return;
    }

    // 提前获取父类和虚表状态（用于回调）
    const parentName = ast.getParentClassName(classStruct, headerDoc);
    const hasVtable = ast.hasVtableStruct(headerDoc, className);

    const currentRegularMethods = ast.getRegularMethods(headerDoc, className);

    AddRegularMethodPanel.createOrShow(
        context.extensionUri,
        className,
        headerUri,
        sourceUri,
        currentRegularMethods,
        // 新增回调：成功添加方法后更新缓存
        (clsName: string, relativePath: string) => {
            // 保持原有的 hasVtable 状态不变
            syncService.registerClass(clsName, relativePath, parentName, hasVtable);
        }
    );
}