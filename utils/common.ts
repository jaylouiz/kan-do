export function uuid(): string {
  return Math.random().toString(16).slice(2);
}

/**
 * Parses a time value from various formats into seconds
 * @param value The value to parse, can be a number, string, or any format containing time information
 * @returns The time value in seconds, or null if parsing failed
 * @example
 * parseTimeValue("15") => 900 (15 minutes in seconds)
 * parseTimeValue("15 min") => 900
 * parseTimeValue("1 hour") => 3600
 * parseTimeValue("2h") => 7200
 */
/**
 * Parses a time value string or number into seconds
 * @param value Time value as string or number
 * @returns Number of seconds or null if invalid
 */
export function parseTimeValue(value: string | number | undefined | null): number | null {
  if (!value) return null;

  // Convert to string and normalize
  const strValue = value.toString().toLowerCase().trim();

  // Try to parse time with unit
  const match = strValue.match(/(\d+)\s*(min|hour|h|m)?/i);
  if (!match) return null;

  const number = parseInt(match[1]!);
  const unit = match[2]?.toLowerCase();

  // Convert to seconds based on unit
  if (unit === "hour" || unit === "h") {
    return number * 3600; // hours to seconds
  }
  return number * 60; // minutes to seconds (default)
}
