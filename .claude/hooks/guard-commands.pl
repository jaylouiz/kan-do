# Command analysis of guard-commands.sh (#387, #654): read from stdin as one string (`perl -0777 -n`), prints the reason a command is
# blocked, nothing when it is fine. Lives in its own file so an apostrophe (in a message, a regex, a comment) cannot end a
# surrounding shell string and break the hook for every Bash call (the failure class #640 removed from e2e-before-merge.sh).
  my $c = $_;
  my $neutral = sub { my $t = shift; $t =~ tr/;&|\n/    /; $t };
  $c =~ s/\\\n/ /g;
  $c =~ s/(<<-?[ \t]*(['"]?)(\w+)\2)(.*?\n[ \t]*\3[ \t]*)(?=\n|$)/$1 . $neutral->($4)/gse;
  $c =~ s/^[ \t]*#.*$//gm;
  $c =~ s/('[^']*'|"(?:\\.|[^"\\])*")/$neutral->($1)/ge;
  my $sandbox = qr/\\?"identifier\\?"\s*:\s*\\?"(?:io\.github\.jaylouiz|com\.julius)\.kan-do\.sandbox(?:-[\w\$\{\}]+)?\\?"/;
  my @segs = map {
    my $s = $_;
    $s =~ s/^\s*(?:(?:\$\(|[({!])\s*)*//;
    $s =~ s/^(?:(?:then|do|else|time|sudo|exec|command|nohup|env)\s+|[A-Za-z_]\w*=\S*\s+)*//;
    $s;
  } split /&&|\|\||[;&|\n]/, $c;
  # kd#203: `rm` and a git command in one call stop an unattended worker at a permission dialog (a written rule broken twice).
  if ((grep { /^(?:\S*\/)?rm\s/ } @segs) && (grep { /^(?:\S*\/)?git\s/ } @segs)) {
    print "never chain `rm` with a git command (the pair stops an unattended worker at a permission dialog): run `rm <one path>` as its own call, then the git command as a second call";
    next;
  }
  for my $s (@segs) {
    if ($s =~ /^(?:\S*\/)?pkill\b.*nuxt/) {
      print "never pkill nuxt (it kills the user's :3000 server too): stop your own server by its port's PID, `lsof -ti tcp:<port> -sTCP:LISTEN | xargs kill`"; last;
    }
    if ($s =~ /^(?:npm\s+run\s+tauri:dev\b|npm\s+run\s+tauri\s+(?:--\s+)?dev\b|(?:"?\S*cargo"?\s+|npx\s+(?:\@tauri-apps\/cli\s+)?)?tauri\s+dev\b)/ && $s !~ $sandbox) {
      print "agents never run tauri dev with the real identity (user data folder and Keychain): follow docs/testing/tauri-dev-sandbox.md (skill desktop-verify)"; last;
    }
    if ($s =~ /^(?:npm\s+run\s+release(?![\w:-])|node\s+(?:\.\/)?scripts\/release\.mjs\b)/ && $s !~ /(?:^|\s)--dry-run\b/) {
      print "agents run the release script with --dry-run only (npm run release <version> -- --dry-run); /prepare-release hands the user the real command"; last;
    }
    if ($s =~ /^(?:\S*\/)?gh\s+workflow\s+run\s+["']?(?:\S*\/)?release(?:\.ya?ml)?["']?(?:\s|$)/i) {
      print "agents never trigger the release workflow: /prepare-release hands the user the release command"; last;
    }
    if ($s =~ /^(?:\S*\/)?npm\s+(?:install|i|ci)(?![\w:-])/ || $s =~ /^npx\s+(?:-y\s+|--yes\s+)?npm@(?!11\.19\.0(?:\s|$))\S*\s+(?:install|i|ci)(?![\w:-])/) {
      print "use `npx npm\@11.19.0 install ...` (local npm 11.6 drops \@emnapi lockfile entries)"; last;
    }
    if ($s =~ /^(?:\S*\/)?npm\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*run(?:-script)?\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*terms:approve(?![\w:-])/ || $s =~ /^(?:\S*\/)?node\s+(?:\S+\s+)*?(?:\.\/)?scripts\/copy-terms\.mjs\s+approve\b/) {
      print "only the user approves decided UI terms (docs/copy/terms.lock.json): they run `npm run terms:approve` in their own terminal. Keep the term as it is and write a \"Term question\" line in the PR body"; last;
    }
    if ($s =~ /^(?:\S*\/)?(?:pkill|killall)\b.*(?:\bapp\b|kan-?do|tauri)/) {
      print "never kill the desktop app by name (the user's production app and other workers' windows are named the same): kill the PID of your own `tauri dev` process after `lsof -a -p <pid> -d cwd` shows your worktree (docs/testing/tauri-dev-sandbox.md)"; last;
    }
    if ($s =~ /^(?:\S*\/)?kill\b.*(?:\$\(|\x60)\s*(?:\S*\/)?pgrep\b/) {
      print "never kill what a pgrep pattern matches (it hits other workers' windows and the user's app too): pick the PID of your own `tauri dev` process after `lsof -a -p <pid> -d cwd` shows your worktree, then `kill <pid>` (docs/testing/tauri-dev-sandbox.md)"; last;
    }
    if ($s =~ /^(?:\S*\/)?osascript\b/ && $s =~ /\bfrontmost\b|\bactivate\b|\bkeystroke\b|\bkey\s+code\b/) {
      print "agents never steal focus or send keystrokes (osascript with frontmost, activate, keystroke or key code): run the sandbox window in the background and capture only your own window, `screencapture -x -l <window id>`; skip checks that need the frontmost app and say so in the PR (docs/testing/tauri-dev-sandbox.md, skill desktop-verify)"; last;
    }
    if ($s =~ /^(?:\S*\/)?osascript\b/ && $s =~ /\bSystem Events\b/i && $s =~ /\bprocess(?:es)?\b/i && $s !~ /\bunix\s*id\b/i) {
      print "never select a System Events process by name (several processes are named `app`, one may be the user's production app): select it by `unix id` of a PID whose cwd you verified with `lsof -a -p <pid> -d cwd` (docs/testing/tauri-dev-sandbox.md)"; last;
    }
    if ($s =~ /^(?:\S*\/)?screencapture\b/ && $s !~ /(?:^|\s)-[A-Za-z]*[lR]/) {
      print "no full-screen screencapture (it shows the user's private windows): capture only your own window, `screencapture -x -l <window id>` of a PID-verified process (docs/testing/tauri-dev-sandbox.md)"; last;
    }
  }
