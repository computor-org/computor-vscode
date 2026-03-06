// Auto-generated TypeScript interfaces for Computor Framework
// Generated from Pydantic models in blocks/models.py

/**
 * Data types for test configuration fields
 */
export type FieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "enum"
  | "pattern"
  | "code"
  | "filePath";

/**
 * Definition of a single configuration field
 */
export interface FieldDefinition {
  name: string;
  type: FieldType;
  description: string;
  required?: boolean;
  default?: any;
  enumValues?: string[];
  arrayItemType?: FieldType;
  minValue?: number;
  maxValue?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  placeholder?: string;
  examples?: any[];
}

/**
 * Definition of a qualification/comparison type
 */
export interface QualificationBlock {
  id: string;
  name: string;
  description: string;
  category?: string;
  usesValue?: boolean;
  usesPattern?: boolean;
  usesTolerance?: boolean;
  usesLineNumber?: boolean;
  usesCount?: boolean;
  extraFields?: FieldDefinition[];
  example?: Record<string, any>;
}

/**
 * Definition of a test type
 */
export interface TestTypeBlock {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category?: string;
  qualifications: string[];
  defaultQualification?: string;
  collectionFields?: FieldDefinition[];
  testFields?: FieldDefinition[];
  example?: Record<string, any>;
}

/**
 * All test blocks available for a programming language
 */
export interface LanguageBlocks {
  id: string;
  name: string;
  description: string;
  fileExtensions: string[];
  icon?: string;
  testTypes: TestTypeBlock[];
  qualifications: QualificationBlock[];
  configFields?: FieldDefinition[];
  defaults?: Record<string, any>;
}

/**
 * Registry of all language blocks
 */
export interface BlockRegistry {
  version: string;
  languages: LanguageBlocks[];
}

/**
 * Individual test case configuration
 */
export interface TestCase {
  name: string;
  qualification?: string;
  value?: any;
  pattern?: string;
  expectedExitCode?: number;
  lineNumber?: number;
  ignoreCase?: boolean;
  trimOutput?: boolean;
  relativeTolerance?: number;
  absoluteTolerance?: number;
  numericTolerance?: number;
  allowedOccuranceRange?: [number, number];
  evalString?: string;
  expectedStdout?: string | string[];
  expectedStderr?: string | string[];
  stdin?: string | string[];
}

/**
 * Test collection (group of related tests)
 */
export interface TestCollection {
  name: string;
  type: string;
  description?: string;
  entryPoint?: string;
  timeout?: number;
  inputAnswers?: string[];
  setUpCode?: string[];
  tearDownCode?: string[];
  compiler?: string;
  compilerFlags?: string[];
  linkerFlags?: string[];
  args?: string[];
  tests: TestCase[];
}

/**
 * Complete test suite definition
 */
export interface TestSuite {
  name?: string;
  description?: string;
  version?: string;
  properties: {
    timeout?: number;
    relativeTolerance?: number;
    absoluteTolerance?: number;
    tests: TestCollection[];
  };
}
