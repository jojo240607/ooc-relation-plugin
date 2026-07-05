import * as vscode from 'vscode';
import { overrideMethodsInSource } from '../operations/overrideMethodsOperation';

export async function quickOverrideMethod(
    className: string,
    headerUri: vscode.Uri,
    fromClass: string,
    method: { returnType: string; name: string; params: string },
    vtablePath: string
): Promise<{ success: boolean; message: string }> {
    const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);
    
    // 确保源文件存在
    try { await vscode.workspace.fs.stat(sourceUri); } catch {
        return { success: false, message: `Source file ${className}.c not found.` };
    }

    const methodWithVtable = {
        returnType: method.returnType,
        name: method.name,
        params: method.params,
        fromClass: fromClass,
        vtablePath: vtablePath
    };

    return await overrideMethodsInSource(className, headerUri, sourceUri, [methodWithVtable]);
}