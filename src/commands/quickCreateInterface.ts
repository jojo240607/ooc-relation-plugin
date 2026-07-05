import * as vscode from 'vscode';
import { createInterfaceFiles } from '../operations/createInterfaceOperation';

export async function quickCreateInterface(
    interfaceName: string,
    folderUri: vscode.Uri,
    methods: { returnType: string; name: string; params: string }[] = []
): Promise<{ success: boolean; message: string }> {
    return await createInterfaceFiles(interfaceName, folderUri, methods, false);
}