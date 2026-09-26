// Wallet button for the Create Agent launch step. Encoding and mining live in
// ArgusLaunch so the same path runs under node tests with a mock provider.
(function () {
  function tools() {
    if (!window.ArgusLaunch || !window.ethers) {
      throw new Error("Launch tools did not load. Refresh and try again. The agent is still saved.");
    }
    return window.ArgusLaunch;
  }

  window.ArgusMint = {
    available: function () { return !!(window.ArgusLaunch && window.ethers); },
    hasWallet: function () { return !!window.ethereum; },
    connect: function () {
      if (!window.ethereum) throw new Error("Install MetaMask or another injected wallet, then try again.");
      return tools().connectWallet(window.ethereum);
    },
    launch: function (opts) {
      if (!window.ethereum) throw new Error("Install MetaMask or another injected wallet, then try again.");
      return tools().runLaunch(window.ethereum, opts);
    },
  };
})();
