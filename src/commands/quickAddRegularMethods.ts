import * as vscode from 'vscode';
import { addRegularMethodsToClass } from '../operations/addRegularMethodOperation';

export async function quickAddRegularMethods(
    className: string,
    headerUri: vscode.Uri,
    methods: { returnType: string; name: string; params: string }[]
): Promise<{ success: boolean; message: string }> {
    const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);
    try { await vscode.workspace.fs.stat(sourceUri); } catch {
        return { success: false, message: `Source file ${className}.c not found.` };
    }
    return await addRegularMethodsToClass(className, headerUri, sourceUri, methods);
}