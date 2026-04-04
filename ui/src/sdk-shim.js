// Use the ADO host's pre-loaded SDK instance if available (prevents double-init).
// The HTML page sets window.__AzureDevOpsSDK from the AMD cache before this bundle runs.
var hostSDK = typeof window !== "undefined" && window.__AzureDevOpsSDK;
module.exports = hostSDK || require("../node_modules/azure-devops-extension-sdk/SDK.js");
