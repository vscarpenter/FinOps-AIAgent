module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/integration/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/app.ts',
    '!src/infrastructure.ts'
  ],
  coverageDirectory: 'coverage/integration',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/integration/setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  testTimeout: 60000, // 60 seconds for integration tests
  maxWorkers: 1, // Run integration tests sequentially to avoid AWS rate limits
  bail: false, // Continue running tests even if some fail
  forceExit: true, // Force Jest to exit after tests complete
  detectOpenHandles: true, // Detect handles that prevent Jest from exiting
  
  // Integration test specific settings
  globals: {
    'ts-jest': {
      tsconfig: {
        compilerOptions: {
          // Allow longer compilation for integration tests
          incremental: false,
          tsBuildInfoFile: null
        }
      }
    }
  },
  
  // Custom reporters for integration tests
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'coverage/integration',
      outputName: 'integration-test-results.xml',
      suiteName: 'AWS Spend Monitor Integration Tests'
    }]
  ],
  
  // Environment variables for integration tests
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/integration/jest-env.js']
};