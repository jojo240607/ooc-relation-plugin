import * as vscode from 'vscode';
import { generateHeader } from '../templates/classHeader';
import { generateSource } from '../templates/classSource';
import { syncService } from '../sync/ClassSyncService'; // 实际导入路径根据项目调整
import { relationStore } from '../sync/ClassRelationStore';

export async function quickCreateClass(className: string, folderUri: vscode.Uri): Promise<{ success: boolean; message: string }> {
    try {
        const headerUri = vscode.Uri.joinPath(folderUri, `${className}.h`);
        const sourceUri = vscode.Uri.joinPath(folderUri, `${className}.c`);

        // 检查是否存在
        try { await vscode.workspace.fs.stat(headerUri); return { success: false, message: `${className}.h already exists.` }; } catch {}
        try { await vscode.workspace.fs.stat(sourceUri); return { success: false, message: `${className}.c already exists.` }; } catch {}

        const headerContent = generateHeader(className);
        const sourceContent = generateSource(className);

        await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent));
        await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent));

        // 更新关系缓存
        const relativePath = vscode.workspace.asRelativePath(headerUri);
        await syncService.registerClass(className, relativePath, null, false);

        // 打开生成的文件（可选，保持一致性）
        const doc = await vscode.workspace.openTextDocument(headerUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        return { success: true, message: `Base class ${className} created at ${relativePath}` };
    } catch (err: any) {
        return { success: false, message: `Error creating class: ${err.message}` };
    }
}