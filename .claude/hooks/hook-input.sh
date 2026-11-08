# Sourced by the PreToolUse gates (e2e-before-merge.sh, guard-commands.sh), never run on its own (kd#2).
# hook_command "<hook input JSON>" prints .tool_input.command. A missing `jq` must not turn the gate off
# silently (an empty command matches nothing and the hook exits 0), so without jq the JSON is read by perl's
# core JSON::PP instead; the gates need perl anyway. Exit status is non-zero when neither can read the input
# (no jq and no perl, a broken perl, malformed JSON, a tool_input or command that is not an object or string): the caller then falls back to a coarse text check.
hook_command() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r '.tool_input as $t | if $t == null then "" elif ($t | type) != "object" then error("odd tool_input") else ($t.command // "") as $c | if ($c | type) == "string" then $c else error("odd command") end end'
  else
    # exit 1 for a tool_input or command of an odd shape (array, string, ...): the caller's text check applies then.
    printf '%s' "$1" | perl -MJSON::PP -0777 -ne 'use strict; binmode STDOUT, ":utf8"; my $t = decode_json($_)->{tool_input}; if (defined $t && ref $t ne "HASH") { exit 1 } my $c = defined $t ? $t->{command} : undef; if (defined $c && ref $c) { exit 1 } print defined $c ? $c : ""'
  fi
}

# kd#9: the checks (Stop hook verify.sh, per-edit edit-root.sh, impeccable-worktree.sh) read their input through the helpers
# below. Same rule as hook_command: jq when present (the fast path, one process per call), else perl's core JSON::PP, so
# a contributor without jq keeps the per-edit and Stop feedback. Each exits non-zero when the input cannot be read.

# hook_get <json> <dotted.path>: the value at the path; "" when absent or null, a string as is, anything else as JSON.
hook_get() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r --arg p "$2" 'getpath($p | split(".")) // "" | if type == "string" then . else tojson end' 2>/dev/null
  else
    printf '%s' "$1" | KANDO_P="$2" perl -MJSON::PP -0777 -ne 'binmode STDOUT, ":utf8"; my $v = decode_json($_); for my $k (split /\./, $ENV{KANDO_P}) { $v = ref $v eq "HASH" ? $v->{$k} : undef } if (!defined $v) { print "" } elsif (ref $v) { print JSON::PP->new->canonical->encode($v) } else { print $v }' 2>/dev/null
  fi
}

# hook_fields <json>: the per-edit fields, one per line: tool_input.file_path, tool_name, the Bash edit-diff state
# (none|skip|diff), cwd, duration_ms.
hook_fields() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r '(.tool_input.file_path // ""), (.tool_name // ""), ((.tool_response.bashEditDiff? // null) as $d | if ($d | type) != "object" then "none" elif $d.skipped == true then "skip" elif $d.unavailable == true then "none" else "diff" end), (.cwd // ""), ((.duration_ms // "") | tostring)' 2>/dev/null
  else
    printf '%s' "$1" | perl -MJSON::PP -0777 -ne 'binmode STDOUT, ":utf8"; my $j = decode_json($_); my $ti = ref $j->{tool_input} eq "HASH" ? $j->{tool_input} : {}; my $d = ref $j->{tool_response} eq "HASH" ? $j->{tool_response}{bashEditDiff} : undef; my $s = ref $d ne "HASH" ? "none" : $d->{skipped} ? "skip" : $d->{unavailable} ? "none" : "diff"; for ($ti->{file_path}, $j->{tool_name}, $s, $j->{cwd}, $j->{duration_ms}) { my $v = $_; $v = "" if !defined $v || ref $v; print "$v\n" }' 2>/dev/null
  fi
}

# hook_changed_files <json>: the paths of tool_response.bashEditDiff (changedFiles plus files[].filePath), unique, one per line.
hook_changed_files() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r '.tool_response.bashEditDiff | ((.changedFiles // []) + [.files[]?.filePath]) | unique | .[]' 2>/dev/null
  else
    printf '%s' "$1" | perl -MJSON::PP -0777 -ne 'binmode STDOUT, ":utf8"; my $j = decode_json($_); my $d = ref $j->{tool_response} eq "HASH" ? $j->{tool_response}{bashEditDiff} : undef; exit 0 if ref $d ne "HASH"; my %s; for my $f (@{ ref $d->{changedFiles} eq "ARRAY" ? $d->{changedFiles} : [] }, map { ref $_ eq "HASH" ? $_->{filePath} : () } @{ ref $d->{files} eq "ARRAY" ? $d->{files} : [] }) { $s{$f} = 1 if defined $f && !ref $f } print "$_\n" for sort keys %s' 2>/dev/null
  fi
}

# hook_retarget <json> <root> [<file>]: the input as one compact JSON line with cwd = <root>; with <file> also as a Write of that file.
hook_retarget() {
  if command -v jq >/dev/null 2>&1; then
    if [ -n "${3:-}" ]; then
      printf '%s' "$1" | jq -c --arg r "$2" --arg f "$3" '.cwd = $r | .tool_name = "Write" | .tool_input = {file_path: $f}'
    else
      printf '%s' "$1" | jq -c --arg r "$2" '.cwd = $r'
    fi
  else
    # perl -n would read the arguments as file names, so they travel in the environment.
    printf '%s' "$1" | KANDO_R="$2" KANDO_F="${3:-}" perl -MJSON::PP -0777 -ne 'binmode STDOUT, ":utf8"; my $j = decode_json($_); $j->{cwd} = $ENV{KANDO_R}; if (length $ENV{KANDO_F}) { $j->{tool_name} = "Write"; $j->{tool_input} = { file_path => $ENV{KANDO_F} } } print JSON::PP->new->canonical->encode($j), "\n"'
  fi
}

# hook_additional_context (stdin): .hookSpecificOutput.additionalContext of a hook's JSON output; "" when absent.
hook_additional_context() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null
  else
    perl -MJSON::PP -0777 -ne 'binmode STDOUT, ":utf8"; my $j = eval { decode_json($_) }; my $h = ref $j eq "HASH" ? $j->{hookSpecificOutput} : undef; my $c = ref $h eq "HASH" ? $h->{additionalContext} : undef; print $c if defined $c && !ref $c' 2>/dev/null
  fi
}

# hook_context_json <event> <text>: {"hookSpecificOutput":{"hookEventName":<event>,"additionalContext":<text>}}.
hook_context_json() {
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg e "$1" --arg c "$2" '{hookSpecificOutput: {hookEventName: $e, additionalContext: $c}}'
  else
    perl -MJSON::PP -e 'binmode STDOUT, ":utf8"; print JSON::PP->new->canonical->encode({ hookSpecificOutput => { hookEventName => $ARGV[0], additionalContext => $ARGV[1] } }), "\n"' "$1" "$2"
  fi
}

# hook_system_message_json <text>: {"systemMessage":<text>}.
hook_system_message_json() {
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg m "$1" '{systemMessage: $m}'
  else
    perl -MJSON::PP -e 'binmode STDOUT, ":utf8"; print JSON::PP->new->canonical->encode({ systemMessage => $ARGV[0] }), "\n"' "$1"
  fi
}
