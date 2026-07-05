import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';

/**
 * 为指定类添加成员变量
 * @returns 操作结果
 */
export async function addMembersToClass(
    className: string,
    headerUri: vscode.Uri,
    members: { type: string; name: string }[]
): Promise<{ success: boolean; message: string }> {
    try {
        const doc = await vscode.workspace.openTextDocument(headerUri);
        const structInfo = ast.findStruct(doc, className);
        if (!structInfo) {
            return { success: false, message: `Could not find struct ${className} in header.` };
        }

        const endLine = structInfo.bodyEnd;
        if (endLine < 0) {
            return { success: false, message: 'Invalid struct definition.' };
        }

        const lines = doc.getText().split('\n');
        const braceLine = lines[endLine];
        const braceIndentMatch = braceLine.match(/^(\s*)/);
        const baseIndent = braceIndentMatch ? braceIndentMatch[0] : '';
        const memberIndent = baseIndent + '    ';

        const declarations = members.map(m => `${memberIndent}${m.type} ${m.name};`).join('\n');

        const insertPos = doc.offsetAt(new vscode.Position(endLine, 0));
        const newText = doc.getText().slice(0, insertPos) + declarations + '\n' + doc.getText().slice(insertPos);

        const we = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
        );
        we.replace(headerUri, fullRange, newText);
        await vscode.workspace.applyEdit(we);

        // 保存文件
        const updatedDoc = await vscode.workspace.openTextDocument(headerUri);
        await updatedDoc.save();

        return { success: true, message: `Successfully added ${members.length} member(s) to ${className}.` };
    } catch (err: any) {
        return { success: false, message: `Error adding members: ${err.message}` };
    }
}