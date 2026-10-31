import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({base:'/sam-bundle/',worker:{format:'es'},build:{target:'es2022',outDir:'../../public/sam-bundle',emptyOutDir:true,
 rollupOptions:{input:fileURLToPath(new URL('./src/main.js',import.meta.url)),preserveEntrySignatures:'strict',output:{entryFileNames:'engine.js'}}}});
