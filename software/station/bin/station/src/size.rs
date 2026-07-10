/// Parses a human-readable byte size such as `256M`, `1.5G`, or a plain byte count.
///
/// Units are binary multiples (`1K` = 1024). `K`, `M`, `G` and `T` are accepted,
/// case-insensitively, with an optional `B` or `iB` suffix. Fractional values are
/// allowed and floor to whole bytes.
pub fn parse_size<T>(input: &str) -> Result<T, String>
where
    T: TryFrom<u64>,
{
    let trimmed = input.trim();
    let split = trimmed
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(trimmed.len());
    let (number, unit) = trimmed.split_at(split);

    let multiplier: u128 = match unit.trim().to_ascii_uppercase().as_str() {
        "" | "B" => 1,
        "K" | "KB" | "KIB" => 1 << 10,
        "M" | "MB" | "MIB" => 1 << 20,
        "G" | "GB" | "GIB" => 1 << 30,
        "T" | "TB" | "TIB" => 1 << 40,
        _ => return Err(invalid(input)),
    };

    // Integer math on the mantissa keeps fractions exact: `1.5G` never rounds.
    let (digits, decimals) = match number.split_once('.') {
        Some((whole, frac)) => {
            if frac.is_empty() || frac.contains('.') {
                return Err(invalid(input));
            }
            (format!("{whole}{frac}"), frac.len() as u32)
        }
        None => (number.to_string(), 0),
    };

    let mantissa: u128 = digits.parse().map_err(|_| invalid(input))?;

    mantissa
        .checked_mul(multiplier)
        .map(|scaled| scaled / 10u128.pow(decimals))
        .and_then(|bytes| u64::try_from(bytes).ok())
        .and_then(|bytes| T::try_from(bytes).ok())
        .ok_or_else(|| format!("size `{input}` is too large"))
}

fn invalid(input: &str) -> String {
    format!("invalid size `{input}` (expected e.g. `268435456`, `256M`, `1.5G`)")
}

#[cfg(test)]
mod tests {
    use super::parse_size;

    fn parse(input: &str) -> Result<u64, String> {
        parse_size::<u64>(input)
    }

    #[test]
    fn parses_plain_byte_count() {
        assert_eq!(parse("268435456"), Ok(268435456));
    }

    #[test]
    fn parses_zero() {
        assert_eq!(parse("0"), Ok(0));
    }

    #[test]
    fn parses_kilobytes_as_binary_multiple() {
        assert_eq!(parse("512K"), Ok(512 * 1024));
    }

    #[test]
    fn parses_megabytes_as_binary_multiple() {
        assert_eq!(parse("256M"), Ok(256 * 1024 * 1024));
    }

    #[test]
    fn parses_gigabytes_as_binary_multiple() {
        assert_eq!(parse("1G"), Ok(1024 * 1024 * 1024));
    }

    #[test]
    fn parses_terabytes_as_binary_multiple() {
        assert_eq!(parse("1T"), Ok(1024u64.pow(4)));
    }

    #[test]
    fn unit_is_case_insensitive() {
        assert_eq!(parse("1g"), parse("1G"));
    }

    #[test]
    fn accepts_b_suffix() {
        assert_eq!(parse("256MB"), Ok(256 * 1024 * 1024));
    }

    #[test]
    fn accepts_ib_suffix() {
        assert_eq!(parse("256MiB"), Ok(256 * 1024 * 1024));
    }

    #[test]
    fn accepts_surrounding_whitespace() {
        assert_eq!(parse("  256M  "), Ok(256 * 1024 * 1024));
    }

    #[test]
    fn accepts_space_between_number_and_unit() {
        assert_eq!(parse("256 M"), Ok(256 * 1024 * 1024));
    }

    #[test]
    fn rejects_empty_input() {
        assert!(parse("").is_err());
    }

    #[test]
    fn rejects_missing_number() {
        assert!(parse("M").is_err());
    }

    #[test]
    fn rejects_unknown_unit() {
        assert!(parse("12X").is_err());
    }

    #[test]
    fn parses_fractional_value_exactly() {
        assert_eq!(parse("1.5G"), Ok(1024 * 1024 * 1024 * 3 / 2));
    }

    #[test]
    fn parses_fractional_value_below_one() {
        assert_eq!(parse("0.5M"), Ok(512 * 1024));
    }

    #[test]
    fn parses_fraction_with_many_decimal_places() {
        assert_eq!(parse("1.250K"), Ok(1280));
    }

    #[test]
    fn floors_fraction_that_is_not_a_whole_byte_count() {
        // 1.1 * 1024 = 1126.4
        assert_eq!(parse("1.1K"), Ok(1126));
    }

    #[test]
    fn fractional_math_is_exact_at_large_scales() {
        // f64 would be fine here, but integer math makes it exact by construction.
        assert_eq!(parse("1.5T"), Ok(1024u64.pow(4) * 3 / 2));
    }

    #[test]
    fn rejects_malformed_decimal() {
        assert!(parse("1.2.3G").is_err());
    }

    #[test]
    fn rejects_trailing_dot() {
        assert!(parse("1.G").is_err());
    }

    #[test]
    fn rejects_negative_values() {
        assert!(parse("-5M").is_err());
    }

    #[test]
    fn rejects_overflow_instead_of_panicking() {
        assert!(parse("99999999999999999999G").is_err());
    }

    #[test]
    fn rejects_value_that_does_not_fit_target_type() {
        assert!(parse_size::<u32>("8G").is_err());
    }

    #[test]
    fn error_message_names_the_bad_input() {
        let err = parse("12X").unwrap_err();
        assert!(err.contains("12X"), "unhelpful error: {err}");
    }
}
