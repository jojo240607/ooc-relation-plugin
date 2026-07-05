import * as vscode from 'vscode';
import { modifyFunctionBody } from '../operations/modifySourceOperations';

export async function quickModifyFunction(
    headerUri: vscode.Uri,
    functionName: string,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    return await modifyFunctionBody(headerUri, functionName, codeContent, mode);
}