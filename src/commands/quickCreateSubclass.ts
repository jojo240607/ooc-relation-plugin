import * as vscode from 'vscode';
import { createSubclassFiles } from '../operations/createSubclassOperation';

export async function quickCreateSubclass(
    parentName: string,
    parentUri: vscode.Uri,
    subclassName: string,
    targetFolderUri?: vscode.Uri
): Promise<{ success: boolean; message: string }> {
    return await createSubclassFiles(parentName, parentUri, subclassName, targetFolderUri, false);
}