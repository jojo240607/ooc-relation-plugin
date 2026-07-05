import * as vscode from 'vscode';
import { readSourceContent } from '../operations/modifySourceOperations';

export async function quickReadSource(headerUri: vscode.Uri): Promise<{ success: boolean; message: string }> {
    return await readSourceContent(headerUri);
}