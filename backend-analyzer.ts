import AdmZip from 'adm-zip';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export function analisarPacoteReal(filePath: string) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carol-'));
    let resultado = { manifest: '', codigo: '', erro: null as string | null };

    try {
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.zip') {
            const zip = new AdmZip(filePath);
            zip.extractAllTo(tempDir, true);
            const files = fs.readdirSync(tempDir);
            resultado.codigo += `Estrutura ZIP: ${files.join(', ')}\n`;
        } 
        else if (ext === '.apk') {
            // Apktool (com timeout e limite de memória)
            try {
                execSync(`apktool d -f -s -o "${tempDir}/apktool" "${filePath}"`, { stdio: 'pipe', timeout: 60000 });
                const manifestPath = path.join(tempDir, 'apktool', 'AndroidManifest.xml');
                if (fs.existsSync(manifestPath)) {
                    resultado.manifest = fs.readFileSync(manifestPath, 'utf8');
                }
            } catch (e: any) {
                resultado.codigo += `[Aviso] Apktool falhou: ${e.message}\n`;
            }

            // JADX com limite de RAM (Xmx512m) para não derrubar o Termux
            try {
                execSync(`jadx -Xmx512m -d "${tempDir}/jadx" "${filePath}"`, { stdio: 'pipe', timeout: 120000 });
                const files = execSync(`find "${tempDir}/jadx" -name "*.java" | head -30`).toString().trim().split('\n');
                for (const f of files) {
                    if (f && fs.existsSync(f) && fs.statSync(f).isFile()) {
                        resultado.codigo += fs.readFileSync(f, 'utf8') + '\n';
                    }
                }
            } catch (e: any) {
                resultado.codigo += `[Aviso] JADX falhou (talvez APK muito grande): ${e.message}\n`;
            }
        }
    } catch (err: any) {
        resultado.erro = err.message;
    } finally {
        try { execSync(`rm -rf "${tempDir}"`); } catch (e) {}
    }

    return resultado;
}
