import * as vscode from 'vscode';
import { createClassFiles } from '../operations/createClassOperation';

export async function quickCreateClass(
    className: string,
    folderUri: vscode.Uri
): Promise<{ success: boolean; message: string }> {
    return await createClassFiles(className, folderUri, true);
}