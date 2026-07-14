//! Exact parser-parity ABI type-string classifier.
//!
//! graph-node <= 0.41 parsed `ethereum.decode(typeString, data)` type strings with
//! **ethabi**; >= 0.42 (PR graphprotocol/graph-node#6063) switched to **alloy**, which is
//! strict where ethabi was absurdly lenient. A type string that ethabi accepts but alloy
//! rejects makes `decode` return `null` on modern graph-node — the silent-data-loss bug
//! this crate exists to detect.
//!
//! We compile the *real* `ethabi` and `alloy-dyn-abi` parsers to WASM rather than
//! approximating them in TypeScript: ethabi's leniency is bizarre (it parses `" address"`
//! as `uint8`) and any reimplementation would miss cases. `classify_json` is the single
//! export; classification is `DIVERGENT ⇔ ethabi accepts && alloy rejects`.

use alloy_dyn_abi::DynSolType;
use ethabi::param_type::Reader;
use wasm_bindgen::prelude::*;

/// Classify one type string. Returns a JSON object (built by hand — no serde dependency):
///
/// ```json
/// { "ethabi": string | null,   // Debug of the parsed ethabi ParamType, or null if rejected
///   "alloy_ok": bool,          // whether alloy_dyn_abi::DynSolType::parse succeeded
///   "alloy_err": string | null // alloy's rejection message, or null on success
/// }
/// ```
///
/// DIVERGENT (breaks on graph-node >= 0.42) ⇔ `ethabi != null && alloy_ok == false`.
#[wasm_bindgen]
pub fn classify_json(s: &str) -> String {
    // ethabi (<= 0.41). Reader::read is the exact entry point graph-node used.
    let ethabi = match Reader::read(s) {
        Ok(pt) => Some(format!("{pt:?}")),
        Err(_) => None,
    };

    // alloy (>= 0.42). DynSolType::parse is the exact entry point graph-node uses now.
    let (alloy_ok, alloy_err) = match DynSolType::parse(s) {
        Ok(_) => (true, None),
        Err(e) => (false, Some(e.to_string())),
    };

    let mut out = String::with_capacity(64);
    out.push('{');
    out.push_str("\"ethabi\":");
    match &ethabi {
        Some(v) => push_json_string(&mut out, v),
        None => out.push_str("null"),
    }
    out.push_str(",\"alloy_ok\":");
    out.push_str(if alloy_ok { "true" } else { "false" });
    out.push_str(",\"alloy_err\":");
    match &alloy_err {
        Some(v) => push_json_string(&mut out, v),
        None => out.push_str("null"),
    }
    out.push('}');
    out
}

/// True when a type string breaks on graph-node >= 0.42: ethabi accepts, alloy rejects.
#[cfg(test)]
fn is_divergent(s: &str) -> bool {
    Reader::read(s).is_ok() && DynSolType::parse(s).is_err()
}

/// Append `s` to `out` as a JSON string literal (RFC 8259 escaping).
fn push_json_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn divergent_vectors() {
        // ethabi accepts, alloy rejects → breaks on graph-node >= 0.42.
        for s in [
            "bytes128",
            "bytes33",
            "bytes0",
            "(uint32,uint32,uint32,uint64,bytes32,bytes32,bytes32,bytes128)",
            " address",
            "address ",
            "uint255",
            "uint257",
            "uint8[0]",
            "address[",
        ] {
            assert!(is_divergent(s), "expected DIVERGENT: {s:?}");
        }
    }

    #[test]
    fn fine_vectors() {
        // Accepted by both, or rejected by ethabi too — not the silent-loss case.
        for s in [
            "uint",
            "int",
            "uint32",
            "string",
            "bool[2]",
            "uint256[]",
            "(uint256,address)",
            "(address)",
            "()",
            "tuple(uint256,address)", // ethabi rejects → no deployed subgraph relies on it
        ] {
            assert!(!is_divergent(s), "expected NOT divergent: {s:?}");
        }
    }

    #[test]
    fn ethabi_leniency_is_preserved() {
        // The bizarre cases that motivate using the real crate rather than a TS approximation.
        assert_eq!(Reader::read(" address").unwrap(), ethabi::ParamType::Uint(8));
        assert_eq!(Reader::read("address[").unwrap(), ethabi::ParamType::Uint(8));
    }

    #[test]
    fn json_shape() {
        let j = classify_json("bytes128");
        assert!(j.contains("\"alloy_ok\":false"), "{j}");
        assert!(j.contains("\"ethabi\":\"FixedBytes(128)\""), "{j}");
        let ok = classify_json("uint256");
        assert!(ok.contains("\"alloy_ok\":true"), "{ok}");
    }
}
