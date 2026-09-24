/** اختبارات الوحدة — منطق النطاق الخالص (لا قاعدة بيانات ولا شبكة). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/unit/**/*.spec.ts'],
  moduleNameMapper: {
    '^@wesal/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@wesal/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: false }],
  },
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  testTimeout: 20000,
};
