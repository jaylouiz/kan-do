# Sourced by the PreToolUse gates (e2e-before-merge.sh, guard-commands.sh), never run on its own (#2).
# hook_command "<hook input JSON>" prints .tool_input.command. A missing `jq` must not turn the gate off
# silently (an empty command matches nothing and the hook exits 0), so without jq the JSON is read by perl's
# core JSON::PP instead; the gates need perl anyway. Exit status is non-zero when neither can read the input
# (no jq and no perl, a broken perl, malformed JSON): the caller then falls back to a coarse text check.
hook_command() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r '.tool_input.command // ""'
  else
    printf '%s' "$1" | perl -MJSON::PP -0777 -ne 'use strict; binmode STDOUT, ":utf8"; my $t = decode_json($_)->{tool_input}; my $c = ref $t eq "HASH" ? $t->{command} : undef; print defined $c && !ref $c ? $c : ""'
  fi
}
