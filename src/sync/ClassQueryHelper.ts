import { relationStore, ClassEntry } from './ClassRelationStore';
import * as ast from '../utils/astUtils';
import * as vscode from 'vscode';

export interface VirtualMethod {
    returnType: string;
    name: string;
    params: string;
    fromClass: string;
}

export class ClassQueryHelper {
    /**
     * 获取祖先链中所有带有虚表的类
     */
    static getAncestorChainWithVtable(className: string): ClassEntry[] {
        return relationStore.getAncestorChain(className).filter(entry => entry.hasVtable);
    }

    /**
     * 获取某个类的所有虚函数（包括继承的），按祖先顺序排列，去重
     */
    static async getAllVirtualMethods(className: string): Promise<VirtualMethod[]> {
        const ancestorsWithVtable = this.getAncestorChainWithVtable(className);
        const methods: VirtualMethod[] = [];
        const seen = new Set<string>();
        for (const entry of ancestorsWithVtable) {
            const uri = this.resolveUri(entry.file);
            if (!uri) continue;
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const vfuncs = ast.getVirtualMethods(doc, entry.file.replace(/.*\//, '').replace('.h', ''));
                for (const vf of vfuncs) {
                    if (!seen.has(vf.name)) {
                        seen.add(vf.name);
                        methods.push({ ...vf, fromClass: entry.file.replace(/.*\//, '').replace('.h', '') });
                    }
                }
            } catch {}
        }
        return methods;
    }

    private static resolveUri(relativePath: string): vscode.Uri | null {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!root) return null;
        return vscode.Uri.joinPath(root, relativePath);
    }
}