import * as vscode from 'vscode';
import { syncService } from '../sync/ClassSyncService';
import { relationStore } from '../sync/ClassRelationStore';
import * as ast from '../utils/astUtils';

export async function quickAddMembers(
    className: string,
    headerUri: vscode.Uri,
    members: { type: string; name: string }[]
): Promise<{ success: boolean; message: string }> {
    try {
        const headerDoc = await vscode.workspace.openTextDocument(headerUri);
        const structInfo = ast.findStruct(headerDoc, className);
        if (!structInfo) return { success: false, message: `Struct ${className} not found.` };

        const endLine = structInfo.bodyEnd;
        const lines = headerDoc.getText().split('\n');
        const baseIndent = lines[endLine].match(/^(\s*)/)?.[0] || '';
        const memberIndent = baseIndent + '    ';

        const declarations = members.map(m => `${memberIndent}${m.type} ${m.name};`).join('\n');

        const insertPos = headerDoc.offsetAt(new vscode.Position(endLine, 0));
        const newText = headerDoc.getText().slice(0, insertPos) + declarations + '\n' + headerDoc.getText().slice(insertPos);

        const we = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(headerDoc.positionAt(0), headerDoc.positionAt(headerDoc.getText().length));
        we.replace(headerUri, fullRange, newText);
        await vscode.workspace.applyEdit(we);
        await headerDoc.save();

        return { success: true, message: `${members.length} member(s) added to ${className}.` };
    } catch (err: any) {
        return { success: false, message: `Error adding members: ${err.message}` };
    }
}