/* pay-verify.js — shared on-chain USDC payment verifier for the affiliate hub.
 *
 * Zero-setup design: no accounts, no facilitator, no API keys. The buyer sends
 * USDC on Base directly to the payee wallet; this script checks the payment
 * against public Base RPCs and reports confirmed / pending / failed with a
 * human-readable reason.
 *
 * HOW VERIFICATION WORKS
 *  1. eth_getTransactionReceipt for the pasted tx hash (tried against each
 *     public RPC in order until one answers).
 *  2. Receipt must exist (else: still pending, or no such transaction).
 *  3. Receipt status must be 0x1 (else: the transaction reverted).
 *  4. The receipt logs must contain USDC Transfer events to the payee whose
 *     amounts SUM to at least the expected amount (a single tx can contain
 *     more than one transfer to the same recipient).
 *  5. Optionally, the payment must come FROM a given address (wallet gate):
 *     matches if tx.from is that address, OR if a matching Transfer log's
 *     sender is that address (covers smart-contract wallets, where tx.from
 *     is a bundler rather than the user's wallet).
 *
 * RPC NOTES
 *  Requests are sent as POST with Content-Type: text/plain so the browser
 *  treats them as CORS "simple requests" (no preflight). Public JSON-RPC
 *  endpoints parse the JSON body regardless of content-type. If every RPC
 *  fails, the caller gets reason "rpc-unreachable" and the page points the
 *  buyer at Basescan as a manual fallback.
 *
 * AES DECRYPTION (settlement-tracker unlock only)
 *  decryptBlob() decrypts an AES-256-GCM blob laid out as
 *  IV (12 bytes) || ciphertext || auth tag (16 bytes), with the key derived
 *  as SHA-256(KEY_SALT). KEY_SALT is a public constant: the key is NEVER
 *  stored anywhere, it is derived at runtime — but anyone reading this file
 *  can derive it too. That is deliberate and documented: the AES layer is
 *  obfuscation (it keeps the raw spreadsheet out of the public repo and out
 *  of search indexes), NOT access control. A per-payment key derived from
 *  txHash + payer address is impossible in a purely static setting, because
 *  the file must be encrypted BEFORE any buyer or tx exists and a key that
 *  depends on a future, unknown transaction cannot decrypt a blob made
 *  today. The real gate is the on-chain verification (steps 1-5 above) plus
 *  the sender binding. A determined person can derive the key from this
 *  source and decrypt the blob without paying; that is stated on the page.
 *
 * USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals).
 * Payee: 0x940Db7cF60E0DE63a5A6fBF3D06290f6e7744B2c
 *
 * ADDRESS CORRECTION (verified 2026-10-25, do not "fix" back): the brief for
 * this build listed USDC as 0x833589fCD6eDb6E08f4c7C32D4f71b54bd029029. That
 * address has NO code on Base (eth_getCode returns 0x on two independent
 * RPCs), returns empty for name()/decimals(), and emits zero Transfer logs
 * — it is a lookalike/typo, not USDC. The canonical native Circle USDC on
 * Base is 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913: it has contract code,
 * name() returns "USD Coin", decimals() returns 6, and it emits heavy
 * Transfer activity. The three x402 workers already use the correct address.
 * Had this verifier used the brief's address, EVERY real USDC payment would
 * have been rejected as "wrong recipient" and the rail would be dead on
 * arrival. If the payee ever changes, update PAYEE; if Circle ever
 * redeploys USDC, update USDC — and re-verify both with eth_getCode first.
 */
(function (global) {
  'use strict';

  var PAYEE = '0x940Db7cF60E0DE63a5A6fBF3D06290f6e7744B2c';
  var USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  var RPCS = [
    'https://mainnet.base.org',
    'https://base.publicnode.com',
    'https://1rpc.io/base'
  ];
  // keccak256("Transfer(address,address,uint256)")
  var TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  var RPC_TIMEOUT_MS = 15000;
  // Public constant (see header): key = SHA-256(KEY_SALT). Derivable by
  // anyone reading this file — obfuscation, not access control.
  var KEY_SALT = 'settlement-tracker-v1|' + PAYEE.toLowerCase();

  function padAddress(addr) {
    return '0x' + '000000000000000000000000' + addr.slice(2).toLowerCase();
  }

  function isValidTxHash(h) {
    return typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h.trim());
  }

  function toBigInt(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return BigInt(v); // string, decimal or hex
  }

  function formatUsdc(baseUnits) {
    var n = toBigInt(baseUnits);
    var whole = n / 1000000n;
    var frac = n % 1000000n;
    var fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
    return '$' + whole.toString() + (fracStr ? '.' + fracStr : '.00');
  }

  function usdcToBaseUnits(dollars) {
    return BigInt(Math.round(dollars * 1000000));
  }

  function fetchWithTimeout(url, options, ms) {
    var controller;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      options.signal = controller.signal;
      setTimeout(function () { controller.abort(); }, ms);
    }
    return fetch(url, options);
  }

  function rpcCall(url, method, params) {
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
    }, RPC_TIMEOUT_MS).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      if (json.error) throw new Error(json.error.message || 'RPC error');
      return json.result;
    });
  }

  // Try each RPC in order until one answers. Returns {result, rpc}.
  // Throws the last error if every RPC fails.
  function tryRpcs(method, params, injectedRpcCall) {
    var call = injectedRpcCall || rpcCall;
    var errors = [];
    var chain = Promise.reject(new Error('start'));
    RPCS.forEach(function (url) {
      chain = chain.catch(function () {
        return call(url, method, params).then(function (result) {
          return { result: result, rpc: url };
        }).catch(function (e) {
          errors.push(url + ': ' + (e && e.message ? e.message : String(e)));
          throw e;
        });
      });
    });
    return chain.catch(function (lastErr) {
      var err = new Error('All RPCs failed: ' + errors.join(' | '));
      err.rpcErrors = errors;
      err.cause = lastErr;
      throw err;
    });
  }

  // Find USDC Transfer logs to `payee` inside a receipt.
  // Returns [{amount: BigInt, from: string, logIndex: string}]
  function findPayeeTransfers(receipt, payee) {
    var out = [];
    var logs = (receipt && receipt.logs) || [];
    var payeeTopic = padAddress(payee || PAYEE);
    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      if (!log || !log.topics || log.topics.length < 3) continue;
      if (String(log.address).toLowerCase() !== USDC.toLowerCase()) continue;
      if (String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC0) continue;
      if (String(log.topics[2]).toLowerCase() !== payeeTopic) continue;
      var amount;
      try { amount = BigInt(log.data); } catch (e) { continue; }
      out.push({
        amount: amount,
        from: '0x' + String(log.topics[1]).slice(26).toLowerCase(),
        logIndex: log.logIndex
      });
    }
    return out;
  }

  function sumAmounts(transfers) {
    var total = 0n;
    for (var i = 0; i < transfers.length; i++) total += transfers[i].amount;
    return total;
  }

  // opts: {txHash, expectedAmount (BigInt|number|string, base units),
  //        expectedFrom (optional address),
  //        expectedPayee (optional address; defaults to PAYEE — used by
  //        tests to run the full positive path against a real mainnet
  //        transfer to a different recipient; pages never pass it),
  //        rpcCall (optional, for tests)}
  // Resolves {ok, status, reason, message, details} — never rejects except
  // on programmer error. status: 'confirmed' | 'pending' | 'failed' | 'error'
  function verifyPayment(opts) {
    opts = opts || {};
    var hash = typeof opts.txHash === 'string' ? opts.txHash.trim() : '';
    var expected = toBigInt(opts.expectedAmount || 0);
    var expectedFrom = opts.expectedFrom ? String(opts.expectedFrom).toLowerCase() : null;
    var effectivePayee = opts.expectedPayee ? String(opts.expectedPayee).toLowerCase() : PAYEE.toLowerCase();
    var injected = opts.rpcCall || null;

    if (!isValidTxHash(hash)) {
      return Promise.resolve({
        ok: false, status: 'failed', reason: 'bad-hash',
        message: 'That does not look like a transaction hash. It should be 0x followed by 64 hex characters — copy it from your wallet or from Basescan.'
      });
    }
    var lowerHash = hash.toLowerCase();

    return tryRpcs('eth_getTransactionReceipt', [lowerHash], injected).then(function (r) {
      var receipt = r.result;
      var rpcUsed = r.rpc;
      if (receipt === null) {
        // No receipt yet: either still pending or no such transaction.
        return tryRpcs('eth_getTransaction', [lowerHash], injected).then(function (t) {
          if (t.result) {
            return { ok: false, status: 'pending', reason: 'pending',
              message: 'This transaction exists but has no receipt yet — it is still pending on Base. Wait a few seconds for it to confirm, then check again.',
              details: { rpc: rpcUsed } };
          }
          return { ok: false, status: 'failed', reason: 'not-found',
            message: 'No transaction with that hash exists on Base. Check the hash — it may be from another network, or copied incompletely.',
            details: { rpc: rpcUsed } };
        }).catch(function () {
          // Receipt was null but the tx lookup itself failed: treat as pending
          // rather than failing the buyer for an RPC hiccup.
          return { ok: false, status: 'pending', reason: 'pending',
            message: 'No receipt found yet for this transaction — it may still be pending. Wait a few seconds and check again.',
            details: { rpc: rpcUsed } };
        });
      }

      if (receipt.status !== undefined && receipt.status !== null &&
          receipt.status !== '0x1' && receipt.status !== 1) {
        return { ok: false, status: 'failed', reason: 'tx-failed',
          message: 'This transaction was included on Base but it FAILED (reverted). No payment was made. Send a new payment and try again with the new hash.',
          details: { rpc: rpcUsed, blockNumber: receipt.blockNumber } };
      }

      var transfers = findPayeeTransfers(receipt, effectivePayee);
      if (transfers.length === 0) {
        var otherUsdc = 0n;
        var logs = receipt.logs || [];
        for (var i = 0; i < logs.length; i++) {
          var lg = logs[i];
          if (lg && lg.topics && lg.topics.length >= 3 &&
              String(lg.address).toLowerCase() === USDC.toLowerCase() &&
              String(lg.topics[0]).toLowerCase() === TRANSFER_TOPIC0) {
            try { otherUsdc += BigInt(lg.data); } catch (e) { /* ignore */ }
          }
        }
        var hint = otherUsdc > 0n
          ? ' This transaction did move ' + formatUsdc(otherUsdc) + ' USDC, but to a different address — not the payee on this page. Check you sent it to the address shown here.'
          : ' This transaction contains no USDC transfer to the payee address on this page.';
        return { ok: false, status: 'failed', reason: 'wrong-recipient',
          message: 'No USDC payment to the payee was found in this transaction.' + hint,
          details: { rpc: rpcUsed, blockNumber: receipt.blockNumber } };
      }

      var total = sumAmounts(transfers);
      if (total < expected) {
        return { ok: false, status: 'failed', reason: 'wrong-amount',
          message: 'This transaction paid ' + formatUsdc(total) + ' USDC to the payee, but this item costs ' + formatUsdc(expected) + '. Send the remaining amount (or a new payment of the full amount) and try again with the new hash.',
          details: { rpc: rpcUsed, blockNumber: receipt.blockNumber, paid: total.toString(), expected: expected.toString() } };
      }

      if (expectedFrom) {
        var senderMatches = transfers.some(function (t) {
          return t.from.toLowerCase() === expectedFrom;
        });
        if (senderMatches) {
          return confirmed(rpcUsed, receipt, total, transfers[0].from);
        }
        return tryRpcs('eth_getTransaction', [lowerHash], injected).then(function (t) {
          var tx = t.result;
          if (tx && tx.from && String(tx.from).toLowerCase() === expectedFrom) {
            return confirmed(rpcUsed, receipt, total, tx.from);
          }
          return { ok: false, status: 'failed', reason: 'wrong-sender',
            message: 'This payment is valid, but it was sent from a different wallet than the one connected on this page. The unlock is bound to the connected wallet, so a shared transaction hash cannot be reused. Pay again from the connected wallet and use that new hash.',
            details: { rpc: rpcUsed, blockNumber: receipt.blockNumber, paid: total.toString() } };
        }).catch(function () {
          // Could not fetch the tx: fall back to the log-sender check only.
          return { ok: false, status: 'failed', reason: 'wrong-sender',
            message: 'This payment is valid, but it was sent from a different wallet than the one connected on this page. Pay again from the connected wallet and use that new hash.',
            details: { rpc: rpcUsed, blockNumber: receipt.blockNumber, paid: total.toString() } };
        });
      }

      return confirmed(rpcUsed, receipt, total, transfers[0].from);

      function confirmed(rpc, rcpt, amount, from) {
        return { ok: true, status: 'confirmed', reason: 'confirmed',
          message: 'Payment confirmed on Base: ' + formatUsdc(amount) + ' USDC received.',
          details: { rpc: rpc, blockNumber: rcpt.blockNumber, paid: amount.toString(),
                     expected: expected.toString(), from: from, txHash: lowerHash } };
      }
    }).catch(function (e) {
      return { ok: false, status: 'error', reason: 'rpc-unreachable',
        message: 'Could not reach any Base RPC to check this transaction (' + (e && e.message ? e.message : String(e)) + '). Check your connection and try again — or confirm the payment yourself on Basescan.',
        details: { error: String(e && e.message ? e.message : e) } };
    });
  }

  // Build a USDC transfer() call for eth_sendTransaction (one-click pay).
  function buildUsdcTransferTx(amountBaseUnits) {
    var amountHex = toBigInt(amountBaseUnits).toString(16).padStart(64, '0');
    return {
      to: USDC,
      value: '0x0',
      data: '0xa9059cbb' + padAddress(PAYEE).slice(2) + amountHex
    };
  }

  // AES-256-GCM decrypt via WebCrypto. blob layout: IV(12) || ciphertext || tag(16).
  // Key = SHA-256(KEY_SALT). See the header comment: public derivation,
  // obfuscation only — NOT access control.
  function deriveKey() {
    var subtle = (global.crypto && global.crypto.subtle) ||
      (global.window && global.window.crypto && global.window.crypto.subtle);
    if (!subtle) return Promise.reject(new Error('WebCrypto is not available in this browser.'));
    var data = new TextEncoder().encode(KEY_SALT);
    return subtle.digest('SHA-256', data).then(function (hash) {
      return subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['decrypt']);
    });
  }

  function decryptBlob(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 12 + 16 + 1) {
      return Promise.reject(new Error('Downloaded file is too short to be a valid encrypted blob.'));
    }
    var iv = bytes.slice(0, 12);
    var ct = bytes.slice(12);
    var subtle = (global.crypto && global.crypto.subtle) ||
      (global.window && global.window.crypto && global.window.crypto.subtle);
    if (!subtle) return Promise.reject(new Error('WebCrypto is not available in this browser.'));
    return deriveKey().then(function (key) {
      return subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    });
  }

  var PayVerify = {
    PAYEE: PAYEE,
    USDC: USDC,
    RPCS: RPCS,
    TRANSFER_TOPIC0: TRANSFER_TOPIC0,
    KEY_SALT: KEY_SALT,
    verifyPayment: verifyPayment,
    findPayeeTransfers: findPayeeTransfers,
    buildUsdcTransferTx: buildUsdcTransferTx,
    formatUsdc: formatUsdc,
    usdcToBaseUnits: usdcToBaseUnits,
    isValidTxHash: isValidTxHash,
    decryptBlob: decryptBlob,
    deriveKey: deriveKey,
    tryRpcs: tryRpcs
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PayVerify;
  } else {
    global.PayVerify = PayVerify;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
