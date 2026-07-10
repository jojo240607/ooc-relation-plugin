import * as vscode from 'vscode';
import { writeCode, writeCodeToPath } from '../operations/modifySourceOperations';

export async function quickWriteCode(
    headerUri: vscode.Uri,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    return await writeCode(headerUri, codeContent, mode);
}

export async function quickWriteCodeToPath(
    targetPath: string,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    return await writeCodeToPath(targetPath, codeContent, mode);
}