import * as vscode from 'vscode';

export async function quickWriteCode(
    headerUri: vscode.Uri,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${headerUri.path.split('/').pop()?.replace('.h', '')}.c`);
        await vscode.workspace.fs.stat(sourceUri); // 确保源文件存在

        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const edit = new vscode.WorkspaceEdit();

        if (mode === 'replace') {
            const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
            edit.replace(sourceUri, fullRange, codeContent);
        } else {
            const lastLine = doc.lineAt(doc.lineCount - 1);
            const insertPos = new vscode.Position(lastLine.range.end.line + 1, 0);
            edit.insert(sourceUri, insertPos, `\n${codeContent}`);
        }

        await vscode.workspace.applyEdit(edit);
        await doc.save();
        return { success: true, message: `Code written to ${sourceUri.fsPath}` };
    } catch (err: any) {
        return { success: false, message: `Error writing code: ${err.message}` };
    }
}