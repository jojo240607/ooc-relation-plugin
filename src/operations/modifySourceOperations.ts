import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';

/**
 * 根据头文件 URI 推导源文件 URI
 */
function getSourceUriFromHeader(headerUri: vscode.Uri): vscode.Uri {
    const className = headerUri.path.split('/').pop()?.replace('.h', '') || 'unknown';
    return vscode.Uri.joinPath(headerUri, '..', `${className}.c`);
}

/**
 * 向源文件末尾添加一个 static 函数
 */
export async function addPrivateFunction(
    headerUri: vscode.Uri,
    returnType: string,
    funcName: string,
    params: string,
    body: string
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = getSourceUriFromHeader(headerUri);
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const ok = await ast.insertPrivateFunction(doc, returnType, funcName, params, body);
        if (!ok) return { success: false, message: 'Failed to insert function.' };
        return { success: true, message: `Private function ${funcName} added.` };
    } catch (err: any) {
        return { success: false, message: `Error: ${err.message}` };
    }
}

/**
 * 在源文件的 include 区域之后添加一个全局变量
 */
export async function addGlobalVariable(
    headerUri: vscode.Uri,
    type: string,
    name: string,
    initialValue?: string
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = getSourceUriFromHeader(headerUri);
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const ok = await ast.insertGlobalVariable(doc, type, name, initialValue);
        if (!ok) return { success: false, message: 'Failed to insert variable.' };
        return { success: true, message: `Global variable ${name} added.` };
    } catch (err: any) {
        return { success: false, message: `Error: ${err.message}` };
    }
}

/**
 * 在源文件头部添加 #include 指令
 */
export async function addInclude(
    headerUri: vscode.Uri,
    includePath: string
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = getSourceUriFromHeader(headerUri);
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const ok = await ast.insertInclude(doc, includePath);
        if (!ok) return { success: false, message: 'Failed to insert include.' };
        return { success: true, message: `Include ${includePath} added.` };
    } catch (err: any) {
        return { success: false, message: `Error: ${err.message}` };
    }
}

/**
 * 修改指定函数的函数体（替换或追加）
 */
export async function modifyFunctionBody(
    headerUri: vscode.Uri,
    functionName: string,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    const cleanName = functionName.trim();
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${headerUri.path.split('/').pop()?.replace('.h', '')}.c`);
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        let ok = false;
        if (mode === 'replace') {
            ok = await ast.replaceFunctionBody(doc, cleanName, codeContent);
        } else {
            ok = await ast.appendToFunctionBody(doc, cleanName, codeContent);
        }
        if (!ok) {
            return { success: false, message: `Function ${cleanName} not found.` };
        }
        return { success: true, message: `Function ${cleanName} updated.` };
    } catch (err: any) {
        return { success: false, message: `Error modifying function: ${err.message}` };
    }
}


/**
 * 替换或追加整个源文件内容
 */
export async function writeCode(
    headerUri: vscode.Uri,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    try {
        const className = headerUri.path.split('/').pop()?.replace('.h', '') || 'unknown';
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);

        await vscode.workspace.fs.stat(sourceUri); // 确保存在

        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const edit = new vscode.WorkspaceEdit();

        if (mode === 'replace') {
            const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
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


/**
 * 读取与头文件对应的源文件完整内容
 */
export async function readSourceContent(
    headerUri: vscode.Uri
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', headerUri.path.split('/').pop()!.replace('.h', '.c'));
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const content = doc.getText();
        return { success: true, message: content };
    } catch (err: any) {
        return { success: false, message: `Cannot read source: ${err.message}` };
    }
}