import * as vscode from 'vscode';
import { syncService } from '../sync/ClassSyncService';
import { generateInterfaceHeader } from '../templates/interfaceHeader';
import { generateInterfaceSource } from '../templates/interfaceSource';

export async function quickCreateInterface(
    interfaceName: string,
    folderUri: vscode.Uri,
    methods: { returnType: string; name: string; params: string }[] = []
): Promise<{ success: boolean; message: string }> {
    try {
        const headerUri = vscode.Uri.joinPath(folderUri, `${interfaceName}.h`);
        const sourceUri = vscode.Uri.joinPath(folderUri, `${interfaceName}.c`);

        try { await vscode.workspace.fs.stat(headerUri); return { success: false, message: `${interfaceName}.h already exists.` }; } catch {}
        try { await vscode.workspace.fs.stat(sourceUri); return { success: false, message: `${interfaceName}.c already exists.` }; } catch {}

        const headerContent = generateInterfaceHeader(interfaceName, methods);
        const sourceContent = generateInterfaceSource(interfaceName, methods);

        await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent));
        await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent));

        const relativePath = vscode.workspace.asRelativePath(headerUri);
        // 接口可能有虚表（如果定义了方法），所以传递 hasVtable = methods.length > 0
        await syncService.registerClass(interfaceName, relativePath, null, methods.length > 0, true); // isInterface = true

        const doc = await vscode.workspace.openTextDocument(headerUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        return { success: true, message: `Interface ${interfaceName} created at ${relativePath}` };
    } catch (err: any) {
        return { success: false, message: `Error creating interface: ${err.message}` };
    }
}