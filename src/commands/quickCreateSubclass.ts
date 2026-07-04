import * as vscode from 'vscode';
import { syncService } from '../sync/ClassSyncService';
import { relationStore } from '../sync/ClassRelationStore';
import { generateSubclassHeader } from '../templates/subclassHeader';
import { generateSubclassSource } from '../templates/subclassSource';
import * as ast from '../utils/astUtils';

export async function quickCreateSubclass(
    parentName: string,
    parentUri: vscode.Uri,
    subclassName: string,
    targetFolderUri?: vscode.Uri
): Promise<{ success: boolean; message: string }> {
    try {
        // 默认目标文件夹与父类相同
        const targetDir = targetFolderUri || vscode.Uri.joinPath(parentUri, '..');
        const headerUri = vscode.Uri.joinPath(targetDir, `${subclassName}.h`);
        const sourceUri = vscode.Uri.joinPath(targetDir, `${subclassName}.c`);

        try { await vscode.workspace.fs.stat(headerUri); return { success: false, message: `${subclassName}.h already exists.` }; } catch {}
        try { await vscode.workspace.fs.stat(sourceUri); return { success: false, message: `${subclassName}.c already exists.` }; } catch {}

        const headerContent = generateSubclassHeader(subclassName, parentName);
        const sourceContent = generateSubclassSource(subclassName, parentName);

        await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent));
        await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent));

        const relativePath = vscode.workspace.asRelativePath(headerUri);
        await syncService.registerClass(subclassName, relativePath, parentName, false);

        // 确保父类在缓存中
        const parentRelativePath = vscode.workspace.asRelativePath(parentUri);
        if (!relationStore.getClass(parentName)) {
            // 简单添加父类条目（假设父类没有虚表）
            await syncService.registerClass(parentName, parentRelativePath, null, false);
        }

        const doc = await vscode.workspace.openTextDocument(headerUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        return { success: true, message: `Subclass ${subclassName} extending ${parentName} created at ${relativePath}` };
    } catch (err: any) {
        return { success: false, message: `Error creating subclass: ${err.message}` };
    }
}