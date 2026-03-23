import { Project, Node, SyntaxKind, ReferencedSymbol, SourceFile } from 'ts-morph';
import path from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('RefactorManager');

export interface RefactorImpact {
  file: string;
  line: number;
  snippet: string;
}

export class RefactorManager {
  private project: Project;
  private isInitialized: boolean = false;

  constructor() {
    this.project = new Project({
      tsConfigFilePath: path.resolve(process.cwd(), 'tsconfig.json'),
      skipAddingFilesFromTsConfig: false,
    });
  }

  /**
   * Ensure all project files are loaded for global search
   * @param sourcePaths - glob patterns for source files (default: src/**\/*.ts)
   */
  public async initialize(sourcePaths: string[] = ['src/**/*.ts']) {
    if (this.isInitialized) return;
    log.info('[RefactorManager] Initializing project AST...');
    for (const pattern of sourcePaths) {
      this.project.addSourceFilesAtPaths(pattern);
    }
    this.isInitialized = true;
  }

  /**
   * Release project AST memory (call when done with bulk refactoring)
   */
  public dispose() {
    this.project = new Project({
      tsConfigFilePath: path.resolve(process.cwd(), 'tsconfig.json'),
      skipAddingFilesFromTsConfig: false,
    });
    this.isInitialized = false;
    log.info('[RefactorManager] Disposed project AST — memory freed');
  }

  /**
   * Find all references of a function or variable across the project
   */
  public async findReferences(symbolName: string, filePath: string): Promise<RefactorImpact[]> {
    await this.initialize();
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) throw new Error(`File not found in project: ${filePath}`);

    const results: RefactorImpact[] = [];
    
    // Attempt to find the symbol's definition
    const symbolNode = this.findSymbolNode(sourceFile, symbolName);
    if (!symbolNode) {
      log.warn(`[RefactorManager] Symbol '${symbolName}' not found in ${filePath}`);
      return [];
    }

    const referencedSymbols = symbolNode.findReferences();
    for (const referencedSymbol of referencedSymbols) {
      for (const reference of referencedSymbol.getReferences()) {
        const refNode = reference.getNode();
        const refSourceFile = refNode.getSourceFile();
        const line = refNode.getStartLineNumber();
        
        results.push({
          file: refSourceFile.getFilePath(),
          line: line,
          snippet: refNode.getParent()?.getText() || refNode.getText()
        });
      }
    }

    return results;
  }

  /**
   * Help find the node that defines a symbol (Function, Variable, Class, Interface, TypeAlias, Enum)
   */
  private findSymbolNode(sourceFile: SourceFile, symbolName: string): any {
    return sourceFile.getFunction(symbolName) ||
           sourceFile.getVariableDeclaration(symbolName) ||
           sourceFile.getClass(symbolName) ||
           sourceFile.getInterface(symbolName) ||
           sourceFile.getTypeAlias(symbolName) ||
           sourceFile.getEnum(symbolName);
  }

  /**
   * Apply a global rename across the entire project
   */
  public async globalRename(filePath: string, oldName: string, newName: string): Promise<string[]> {
    await this.initialize();
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) throw new Error(`File not found: ${filePath}`);

    const symbolNode = this.findSymbolNode(sourceFile, oldName);
    if (!symbolNode) throw new Error(`Symbol '${oldName}' not found in ${filePath}`);

    log.info(`[RefactorManager] Renaming '${oldName}' to '${newName}' globally...`);
    symbolNode.rename(newName);

    const affectedFiles = this.project.getSourceFiles()
      .filter(f => !f.isSaved())
      .map(f => f.getFilePath());

    await this.project.save();
    return affectedFiles;
  }
}

export const refactorManager = new RefactorManager();
