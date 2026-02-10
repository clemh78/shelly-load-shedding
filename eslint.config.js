const globals = require("globals");

module.exports = [
  {
    ignores: ["test/node_modules/**", "node_modules/**", "eslint.config.js"]
  },

  // Shelly mJS scripts (root .js files)
  {
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2015,
      sourceType: "script",
      globals: {
        // Shelly scripting API
        Shelly: "readonly",
        Timer: "readonly",
        HTTPServer: "readonly",
        MQTT: "readonly",
        print: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-redeclare": "error",
      eqeqeq: ["warn", "always"],
      "no-constant-condition": "warn",
      "no-dupe-keys": "error",
      "no-unreachable": "warn"
    }
  },

  // Node.js test files
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "commonjs",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-redeclare": "error",
      eqeqeq: ["warn", "always"],
      "no-constant-condition": "warn",
      "no-dupe-keys": "error",
      "no-unreachable": "warn"
    }
  }
];
