import * as vscode from 'vscode';
import { generateSubclassHeader } from '../templates/subclassHeader';
import { generateSubclassSource } from '../templates/subclassSource';
import { syncService } from '../sync/ClassSyncService';

/**
 * 创建子类文件并更新缓存
 * @param parentName 父类名
 * @param parentHeaderUri 父类头文件 URI
 * @param subclassName 子类名
 * @param targetFolderUri 目标文件夹 URI，默认与父类同目录
 * @param force 是否强制覆盖已存在文件
 */
export async function createSubclassFiles(
    parentName: string,
    parentHeaderUri: vscode.Uri,
    subclassName: string,
    targetFolderUri?: vscode.Uri,
    force: boolean = false
): Promise<{ success: boolean; message: string; relativePath?: string }> {
    try {
        const targetDir = targetFolderUri || vscode.Uri.joinPath(parentHeaderUri, '..');
        const headerUri = vscode.Uri.joinPath(targetDir, `${subclassName}.h`);
        const sourceUri = vscode.Uri.joinPath(targetDir, `${subclassName}.c`);

        if (!force) {
            try { await vscode.workspace.fs.stat(headerUri); return { success: false, message: `${subclassName}.h already exists.` }; } catch {}
            try { await vscode.workspace.fs.stat(sourceUri); return { success: false, message: `${subclassName}.c already exists.` }; } catch {}
        }

        const headerContent = generateSubclassHeader(subclassName, parentName);
        const sourceContent = generateSubclassSource(subclassName, parentName);

        await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent));
        await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent));

        // 更新关系缓存（子类）
        const relativePath = vscode.workspace.asRelativePath(headerUri);
        await syncService.registerClass(subclassName, relativePath, parentName, false);

        // 确保父类在缓存中（如果尚不存在）
        const parentRelativePath = vscode.workspace.asRelativePath(parentHeaderUri);
        if (!(await relationStore.getClass(parentName))) {
            await syncService.registerClass(parentName, parentRelativePath, null, false);
        }

        // 打开生成的头文件
        const doc = await vscode.workspace.openTextDocument(headerUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        return { success: true, message: `Subclass ${subclassName} extending ${parentName} created at ${relativePath}`, relativePath };
    } catch (err: any) {
        return { success: false, message: `Error creating subclass: ${err.message}` };
    }
}

// 为避免循环依赖，relationStore 从同步服务导入可能不在本文件，此处直接使用 syncService 内部调用 relationStore 即可。
// 如果 relationStore 没有导出，可以在 syncService 中添加一个 exists 方法，或直接从 classRelationStore 导入。
// 以下提供一种安全导入方式：从 classRelationStore 导入 relationStore 单例。
import { relationStore } from '../sync/ClassRelationStore';