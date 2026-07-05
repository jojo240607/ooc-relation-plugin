import * as vscode from 'vscode';
import { generateHeader } from '../templates/classHeader';
import { generateSource } from '../templates/classSource';
import { syncService } from '../sync/ClassSyncService'; // 根据你的实际路径调整

/**
 * 创建基类文件并更新缓存
 * @returns 操作结果，成功时附带相对路径
 */
export async function createClassFiles(
    className: string,
    targetDirUri: vscode.Uri
): Promise<{ success: boolean; message: string; relativePath?: string }> {
    try {
        const headerUri = vscode.Uri.joinPath(targetDirUri, `${className}.h`);
        const sourceUri = vscode.Uri.joinPath(targetDirUri, `${className}.c`);

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

        // 打开生成的头文件
        const doc = await vscode.workspace.openTextDocument(headerUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        return { success: true, message: `Base class ${className} created at ${relativePath}`, relativePath };
    } catch (err: any) {
        return { success: false, message: `Error creating class: ${err.message}` };
    }
}