import * as vscode from 'vscode';
import { generateInterfaceHeader } from '../templates/interfaceHeader';
import { generateInterfaceSource } from '../templates/interfaceSource';
import { syncService } from '../sync/ClassSyncService'; // 根据实际路径调整

/**
 * 创建接口文件并更新缓存
 * @param interfaceName 接口名
 * @param targetDirUri 目标目录 URI
 * @param methods 接口方法列表
 * @param force 是否强制覆盖已存在的文件
 * @param silent 是否打开文件
 * @returns 操作结果，成功时附带相对路径
 */
export async function createInterfaceFiles(
    interfaceName: string,
    targetDirUri: vscode.Uri,
    methods: { returnType: string; name: string; params: string }[],
    force: boolean = false,
    silent: boolean = false
): Promise<{ success: boolean; message: string; relativePath?: string }> {
    try {
        const headerUri = vscode.Uri.joinPath(targetDirUri, `${interfaceName}.h`);
        const sourceUri = vscode.Uri.joinPath(targetDirUri, `${interfaceName}.c`);

        // 如果非强制模式，检查文件是否已存在
        if (!force) {
            try { await vscode.workspace.fs.stat(headerUri); return { success: false, message: `${interfaceName}.h already exists.` }; } catch {}
            try { await vscode.workspace.fs.stat(sourceUri); return { success: false, message: `${interfaceName}.c already exists.` }; } catch {}
        }

        const headerContent = generateInterfaceHeader(interfaceName, methods);
        const sourceContent = generateInterfaceSource(interfaceName, methods);

        await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent));
        await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent));

        // 更新关系缓存（接口标记为 isInterface = true）
        const relativePath = vscode.workspace.asRelativePath(headerUri);
        const hasVtable = methods.length > 0; // 有虚函数则视为有虚表
        await syncService.registerClass(interfaceName, relativePath, null, hasVtable, true);
        if (!silent) {
            // 打开生成的头文件
            const doc = await vscode.workspace.openTextDocument(headerUri);
            await vscode.window.showTextDocument(doc, { preview: false });
        }
        return { success: true, message: `Interface ${interfaceName} created at ${relativePath}`, relativePath };
    } catch (err: any) {
        return { success: false, message: `Error creating interface: ${err.message}` };
    }
}