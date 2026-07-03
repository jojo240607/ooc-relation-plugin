import * as vscode from 'vscode';
import { AddMemberPanel } from '../panels/AddMemberPanel';
import * as ast from '../utils/astUtils';
import { syncService } from '../sync/ClassSyncService';

export async function addMembers(context: vscode.ExtensionContext, headerUri: vscode.Uri) {
    if (!headerUri.path.endsWith('.h')) {
        vscode.window.showErrorMessage('Please select a .h file.');
        return;
    }
    const className = headerUri.path.split('/').pop()?.replace('.h', '') || '';
    if (!className) {
        vscode.window.showErrorMessage('Could not determine class name from file.');
        return;
    }

    // 提取已有成员
    const doc = await vscode.workspace.openTextDocument(headerUri);
    const structInfo = ast.findStruct(doc, className);
    const existingMembers: { type: string; name: string }[] = [];

    if (structInfo) {
        for (const m of structInfo.members) {
            if (m.text.startsWith('union') || m.text.startsWith('struct')) {
                const bodyMatch = m.text.match(/\{([^}]*)\}/);
                if (bodyMatch) {
                    const innerBody = bodyMatch[1];
                    const statements = innerBody.split(';');
                    for (const stmt of statements) {
                        const trimmed = stmt.trim();
                        if (!trimmed) continue;
                        const cleanStmt = trimmed.replace(/\/\/.*/, '').trim();
                        const parts = cleanStmt.split(/\s+/);
                        if (parts.length < 2) continue;
                        const varName = parts[parts.length - 1].replace(/^\*/, '');
                        const type = parts.slice(0, -1).join(' ');
                        if (varName === 'vtable' || varName === '_vtable' || varName === 'fun') continue;
                        existingMembers.push({ type, name: varName });
                    }
                }
                continue;
            }
            if (m.name && m.type) {
                if (m.name === 'vtable' || m.name === '_vtable' || m.name === 'fun') continue;
                existingMembers.push({ type: m.type, name: m.name });
            }
        }
    }

    // 提前获取父类和虚表状态（用于回调）
    const parentName = structInfo ? ast.getParentClassName(structInfo, doc) : null;
    const hasVtable = structInfo ? ast.hasVtableStruct(doc, className) : false;

    AddMemberPanel.createOrShow(
        context.extensionUri,
        headerUri,
        className,
        existingMembers,
        // 成功添加成员后的回调
        (clsName: string, relativePath: string) => {
            syncService.registerClass(clsName, relativePath, parentName, hasVtable);
        }
    );
}