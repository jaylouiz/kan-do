# Command parser of e2e-before-merge.sh (#640): read from stdin as one string (`perl -0777 -n`), prints the merge command it
# finds, in the format documented at the call site in the hook. Lives in its own file so an apostrophe (a quote character in a
# comment, a regex) cannot end a surrounding shell string and break the hook for every Bash call.
  my $c = $_;
  # Inside quotes the separators become spaces; `(`, `)` and backticks become \x01-\x03 (no split) and are restored per
  # segment, so a quoted REST path like "pulls/$(...)/merge" still reads as an unresolved PR number.
  my $neutral = sub { my $t = shift; $t =~ tr/;&|\n/ /; $t =~ tr/()\x60/\x01\x02\x03/; $t };
  my $tok = qr/(?:"(?:\\.|[^"\\])*"|'[^']*'|\S)+/;
  # Option words: eat the leading options of $$sr (a wrapper or gh itself; with $keep, all words, positional ones collected). $short lists the one-letter options that take
  # a value, $long a regex of the long ones; `--name=value` and `-Xvalue` carry their value. Returns the -R/--repo value.
  my $eat = sub {
    my ($sr, $short, $long, $keep, $abbrev) = @_;
    my $repo;
    while (($keep || $$sr =~ /^-/) && $$sr =~ s/^($tok)(?:\s+|\z)//) {
      my ($t, $name, $val) = ($1);
      if ($t !~ /^-/) { push @$keep, $t; next }
      if ($t eq "--") { if ($keep) { push @$keep, $1 while $$sr =~ s/^($tok)(?:\s+|\z)// } last } # all that follows is positional
      if ($t =~ /^--([\w-]+)(?:=(.*))?$/s) {
        ($name, $val) = ($1, $2);
        # $abbrev (the GNU wrappers, getopt_long): any prefix of a value-taking long option takes the next word as its value
        # (`env --un GH_REPO gh ...`, `env --chd /tmp gh ...`), an ambiguous one too (the real command rejects it). gh (pflag) has no abbreviations.
        my $takes = $name =~ /^(?:$long)$/ || ($abbrev && grep { index($_, $name) == 0 } split /\|/, $long);
        $val = $1 if !defined $val && $takes && $$sr =~ s/^($tok)(?:\s+|\z)//;
      } elsif ($t =~ /^-([^-].*)$/s) {
        my $cl = $1;
        for my $i (0 .. length($cl) - 1) {
          my $ch = substr($cl, $i, 1);
          next if index($short, $ch) < 0;
          $name = $ch;
          $val = substr($cl, $i + 1);
          $val = $1 if $val eq "" && $$sr =~ s/^($tok)(?:\s+|\z)//;
          last;
        }
      }
      # env -S / --split-string: the value is itself the start of the command line (`env -S "gh pr merge 5"`, `env --split gh pr merge 5`
      # runs gh): put it back in front of the words that follow, quotes dropped.
      if ($abbrev && defined $name && defined $val && $long =~ /split-string/ && ($name eq "S" || (length $name > 1 && index("split-string", $name) == 0))) {
        (my $v = $val) =~ s/^(["'])(.*)\1$/$2/s;
        $$sr = "$v $$sr";
      }
      next unless defined $name && ($name eq "R" || $name eq "repo");
      $val = "\$" if !defined $val || $val eq ""; # -R with nothing after it: its value was a backtick substitution, not a literal
      $repo = $val;
    }
    return $repo;
  };
  # Wrappers: [one-letter options with a value, regex of long options with a value, positional words to skip after the
  # options (timeout: the duration)].
  my %wrap = (
    env => ["uCS", "unset|chdir|split-string|argv0"],
    sudo => ["ughpCDrtUT", "user|group|host|prompt|chdir|role|type|other-user|command-timeout|close-from"],
    doas => ["aCu", "(?!)"],
    time => ["fo", "format|output"],
    exec => ["a", "(?!)"], command => ["", "(?!)"], nohup => ["", "(?!)"],
    timeout => ["ks", "kill-after|signal", 1],
    nice => ["n", "adjustment"],
    stdbuf => ["ioe", "input|output|error"],
    ionice => ["cnpPu", "class|classdata|pid|pgid|uid"],
    xargs => ["IJnPLdEsaRS", "max-args|max-procs|max-lines|delimiter|arg-file|max-chars|process-slot-var"],
    setsid => ["", "(?!)"],
    caffeinate => ["tw", "(?!)"],
    chronic => ["", "(?!)"],
    unbuffer => ["", "(?!)"],
  );
  # A balanced (...) group, for $(...) in a path or heredoc body.
  my $sub = qr/\$(\((?:[^()]++|(?-1))*\))|\x60[^\x60]*\x60/;
  $c =~ s/\\\n/ /g;
  # One left-to-right lexer pass: quoted strings and escapes are neutralised (no separator survives inside), comments are
  # dropped, and a heredoc operator seen OUTSIDE quotes (`<<EOF`, `<<-"EOF"`) drops the body behind the next newline, so a
  # `<<EOF` inside a quoted string opens no heredoc (#516). A heredoc without terminator line stays, as commands (the
  # conservative side).
  my ($out, @pending) = ("");
  pos($c) = 0;
  while (pos($c) < length $c) {
    if ($c =~ /\G\n/gc) {
      $out .= "\n";
      # The terminator is the bare word on its own line; `<<-` also allows leading tabs (bash accepts nothing else). An
      # unquoted delimiter expands `$(...)` and backticks in the body, so those stay as commands (#535).
      for my $h (@pending) {
        my ($term, $dash, $quoted) = @$h;
        my $end = $dash ? qr/\t*\Q$term\E(?:\n|\z)/ : qr/\Q$term\E(?:\n|\z)/;
        next unless $c =~ /\G((?:.*?\n)??)$end/gcs;
        my $body = $1;
        unless ($quoted) { $out .= "\n$&" while $body =~ /(?<!\\)(?:\\\\)*\K$sub/g }
      }
      @pending = ();
    } elsif ($c =~ /\G(\$'(?:\\.|[^'\\])*'|'[^']*'|"(?:\\.|[^"\\])*"|\\.)/gcs) {
      $out .= $neutral->($1);
    } elsif ($c =~ /\G(?<![^\s;&|(])#[^\n]*/gc) {
    } elsif ($c =~ /\G(?<!<)<<(-?)[ \t]*(['"]?)(\w+)\2/gc) {
      push @pending, [$3, $1 ne "", $2 ne ""];
      $out .= "<<";
    } elsif ($c =~ /\G(.)/gcs) {
      $out .= $1;
    }
  }
  # An unquoted backtick substitution as GH_REPO value splits the segment right behind `GH_REPO=`: keep a non-literal marker
  # there, so the value does not read as empty (#596).
  $out =~ s/(?<!\w)GH_REPO=(?=\x60)/GH_REPO=\$/g;
  # A substitution glued into a `pulls/.../merge` path may hold ; & | or a newline: neutralise them so the path stays one
  # word and reads as an unresolved PR number (#535).
  $out =~ s{((?:$sub|[^\s;&|()\x60])*pulls/(?:$sub|[^\s;&|()\x60/])+/merge)(?=$|[\s"'?])}{$neutral->($1)}ge;
  # The body of an ANSI-C string `$'...'` decoded: \xHH, octal, \uHHHH, \UHHHHHHHH and the one-letter escapes. A character
  # that is no word character (a newline, a space, a quote) or an unknown escape becomes a space, so it never builds a
  # command word out of nothing; a NUL ends the string, as in bash.
  my $ansic = sub {
    my $t = shift;
    my %one = (a => 7, b => 8, e => 27, E => 27, f => 12, n => 10, r => 13, t => 9, v => 11, "\\" => 92, "'" => 39, "\"" => 34, "?" => 63);
    $t =~ s{\\(?:x([0-9A-Fa-f]{1,2})|([0-7]{1,3})|u([0-9A-Fa-f]{1,4})|U([0-9A-Fa-f]{1,8})|(.))}{
      my $n = defined $1 ? hex $1 : defined $2 ? oct $2 : defined $3 ? hex $3 : defined $4 ? hex $4 : $one{$5};
      !defined $n || $n > 127 ? " " : $n == 0 ? "\0" : chr($n) =~ /^[\w.\/-]$/ ? chr($n) : " ";
    }gse;
    $t =~ s/\0.*//s; # bash cuts a string at a NUL
    return $t;
  };
  # GH_REPO assigned in an earlier segment (`export GH_REPO=o/r; ...`, `GH_REPO=o/r; ...`) is the default repository of
  # the later ones (#596): the nearest assignment wins, `unset` or an empty value drops it. Flow is not modelled
  # (a subshell or a branch does not scope it): the gate reads the repository the command most plausibly means. A
  # value that is no literal stays as it is and the hook refuses it, like a non-literal -R.
  # A change made inside a subshell, `$(...)` or backticks ($nested: the command segment holds one) may or may not reach the
  # later segments: the repository becomes the non-literal marker `$:subshell`, which the hook refuses (naming the subshell as
  # the reason) instead of guessing. `$:wrapper` is the same for a wrapper that may strip GH_REPO (also one inherited by the hook or given inline in front of the
  # wrapper, #637); a plain `$` is a variable or substitution in the value itself.
  # The control-flow words both $track and $parse skip in front of a command (one list, so they cannot drift apart).
  my $flow = qr/[{!]\s*|(?:then|do|else|elif|if|while|until)\s+/;
  my $envrepo;
  my $inherited = length($ENV{GH_REPO} // ""); # the hook inherits the environment gh will see, until a segment drops it
  my $dropped = 0; # a segment dropped the GH_REPO the hook inherited: gh runs without it, so the repository is origin (#622)
  my $track = sub {
    my ($s, $nested) = @_;
    $s =~ tr/\x01\x02\x03/()\x60/;
    $s =~ s/^\s+//;
    $s =~ s/^(?:$flow|time\s+(?:-p\s+)?)+//; # the control-flow words $parse strips too, and `time` (a keyword: it runs a builtin in this shell)
    # `export` exports what it names; `declare`/`typeset`/`local` only with -x; `readonly` never. A name that is already exported
    # keeps its export attribute under any of them (bash: `export A=1; declare A=2` still hands A=2 to children).
    # `export -n` and `declare +x` take the export attribute away (also when they assign a value).
    my ($kwname, $flags) = ("", "");
    ($kwname, $flags) = ($1, $2) if $s =~ s/^(export|declare|typeset|readonly|local)((?:\s+(?:[-+]\w+|--))*)\s+//;
    my $kw = $kwname ne "" ? 1 : 0;
    my $unexport = ($kwname eq "export" && $flags =~ /-\w*n/) || ($kwname =~ /^(?:declare|typeset|local)$/ && $flags =~ /\+\w*x/);
    my $exports = !$unexport && ($kwname eq "export" || ($kwname =~ /^(?:declare|typeset|local)$/ && $flags =~ /-\w*x/));
    my $new;
    if ($unexport) {
      my @w = map { s/["'\\]//gr } split " ", $s;
      return unless grep { /^GH_REPO(?:=|$)/ } @w;
      $new = "";
    } elsif ($s =~ s/^unset\s+//) {
      my @w = map { s/["'\\]//gr } split " ", $s;
      return if grep { /^-\w*f/ } @w; # unset -f drops a function, not the variable
      return unless grep { $_ eq "GH_REPO" } @w;
      $new = "";
    } else {
      my $assigned;
      while ($s =~ s/^([A-Za-z_]\w*)(\+)?(?:=("[^"]*"|'[^']*'|\S*))?(?:\s+|\z)//) {
        return unless $kw || defined $3; # a bare word without export is a command (`echo GH_REPO=x`)
        next unless $1 eq "GH_REPO" && defined $3;
        $assigned = $2 ? "\$" : $3; # += appends to a value the gate does not know
      }
      # Only a segment that is nothing but assignments persists; behind `export` a bare word is just a name, without it
      # a command (`echo GH_REPO=x`).
      return if length $s && !$kw;
      return unless defined $assigned;
      # `declare`/`local`/`readonly` without -x export nothing new (#608): only a value that is already exported changes (one set
      # by an earlier segment, or inherited by the hook and not dropped since).
      return if $kw && !$exports && !defined $envrepo && !$inherited;
      $new = $assigned;
    }
    $dropped = 1 if $new eq "" && !$nested && $inherited;
    $inherited = 0 if $new eq "" && !$nested; # a drop inside a subshell may not reach the merge: the inherited value stays possible
    # A change inside a subshell is not scoped: the merge may run inside it (`(unset GH_REPO; gh pr merge 5)`) or outside. An
    # inherited value counts as a value to lose (#622).
    $envrepo = $nested ? (defined $envrepo || $new ne "" || $inherited ? "\$:subshell" : undef) : $new eq "" ? undef : $new;
  };
  # One segment -> [full switch, repo, args] when it is a merge command, else nothing.
  my $parse = sub {
    my $s = shift;
    $s =~ tr/\x01\x02\x03/()\x60/;
    $s =~ s/^\s+//;
    my $prefix = "";
    my $xargs = 0;
    my $envdrop = 0; # a wrapper that may strip GH_REPO from the environment of gh
    my $lost = 0; # a non-empty inline GH_REPO= in front of such a wrapper: gh may run without it (#637)
    # A quoted or escaped command word (`\gh`, `"gh"`, a quoted `env`) runs the same command: read it unquoted (#535). An
    # ANSI-C word is decoded (`$'\x67h'` is gh, #596); a locale-quoted `$"gh"` is plain gh.
    my $unquote = sub {
      return unless ${$_[0]} =~ /^($tok)/;
      my ($w, $plain) = ($1, $1);
      $plain =~ s{\$'((?:\\.|[^'\\])*)'}{$ansic->($1)}ge;
      $plain =~ s/\$(?=["'])//g; # the dollar of $"..." (and a $'...' left over)
      $plain =~ s/["'\\]//g;
      ${$_[0]} =~ s/^\Q$w\E/$plain/ if $w ne $plain && $plain =~ m{^[\w./-]+$};
    };
    while (1) {
      $unquote->(\$s);
      if ($s =~ s/^($flow|[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S)*\s+)//) { $prefix .= $1 }
      # A wrapper called by path (`/usr/bin/env`, `/usr/bin/sudo`) is the same wrapper (#659): the directory is part of the prefix, $w the basename.
      elsif ($s =~ s/^((?:\S*\/)?(time|timeout|sudo|doas|exec|command|nohup|env|nice|stdbuf|ionice|xargs|setsid|caffeinate|chronic|unbuffer)\s+)//) {
        my $w = $2;
        $prefix .= $1;
        $xargs = 1 if $w eq "xargs";
        my ($short, $long, $skip) = @{$wrap{$w}};
        my $before = $s;
        $eat->(\$s, $short, $long, undef, 1);
        my $opts = substr($before, 0, length($before) - length($s));
        # `env -i`, `env -u X`, `exec -c`, `sudo` (env_reset) and `doas` (it rebuilds the environment) run gh without the caller GH_REPO; which one is not known.
        # GNU env takes any unambiguous prefix of a long option (`--ignore-env`, `--un=X`, `--split`): a prefix counts, ambiguous ones too.
        my $envstrip = $w eq "env" && ($opts =~ /(?:^|\s)(?:-(?=\s|$)|-\w*[iuS])/ ||
          grep { my $n = /^--([\w-]+)/ ? $1 : ""; length $n && grep { index($_, $n) == 0 } qw(ignore-environment unset split-string) } split " ", $opts);
        if ($w eq "sudo" || $w eq "doas" || $envstrip || ($w eq "exec" && $opts =~ /(?:^|\s)-\w*c/)) {
          $envdrop = 1;
          # An inline value in front of the wrapper may be stripped with it (`GH_REPO=x/y env -u GH_REPO gh ...` runs in origin); one
          # behind it (`env -i GH_REPO=x/y gh ...`) reaches gh. An empty value stays: gh uses the current repository either way.
          $lost = 1 if $prefix =~ s/(?:^|(?<=\s))GH_REPO=(?!(?:""|'')?\s)(?:"[^"]*"|'[^']*'|\S*)\s//g;
        }
        $s =~ s/^$tok(?:\s+|\z)// for 1 .. ($skip || 0);
      }
      else { last }
    }
    return unless $s =~ s/^(?:\S*\/)?gh(?:\s+|$)//;
    my $repo = $eat->(\$s, "R", "repo|hostname");
    my $args;
    if ($s =~ s/^pr(?:\s+|$)//) {
      my $r = $eat->(\$s, "R", "repo");
      $repo = $r if defined $r;
      return unless $s =~ s/^merge(?:\s+|$)//;
      my @keep;
      my $got = $eat->(\$s, "RbFtA", "repo|body|body-file|subject|author-email|match-head-commit", \@keep);
      $repo = $got if defined $got;
      $args = join(" ", @keep);
      $args =~ s/\d*[<>]+&?\s*\S*//g;
    } elsif ($s =~ s/^api\s+//) {
      return unless $s =~ /(?:repos\/(?<owner>(?:$sub|[^\s"'\/])+)\/(?<name>(?:$sub|[^\s"'\/])+)\/)?pulls\/(?<pr>(?:[^\s"'\/\$\x60]|\$\{[^}]*\}|$sub|\$\w+)+)\/merge(?=$|[\s"'?])/;
      my ($owner, $name, $pr) = @+{qw(owner name pr)};
      $args = $pr =~ /^\d+$/ ? $pr : "REST:unresolved";
      return unless $s =~ /(?:^|\s)(?:-X[\s=]*|--method[\s=]+)["']?PUT\b/i;
      # The repository is the one in the path (not GH_REPO or origin); `{owner}/{repo}` is the placeholder gh itself fills in for the
      # current repository (#533).
      $repo = defined $owner && "$owner/$name" ne "{owner}/{repo}" ? "$owner/$name" : undef;
    } else {
      return;
    }
    # `xargs gh pr merge` takes the PR from stdin: not resolvable.
    $args = "XARGS:unresolved" if $xargs;
    # Inline `GH_REPO=o/r gh ...` names the repository when nothing else does (#535).
    my $inline_empty = 0;
    unless (defined $repo) {
      $repo = $1 while $prefix =~ /(?:^|\s)GH_REPO=("[^"]*"|'[^']*'|\S*)\s/g;
      ($repo, $inline_empty) = (undef, 1) if defined $repo && $repo =~ /^(?:""|'')?$/; # an empty value is no repository: gh uses the current one
    }
    # set in an earlier segment (#596); behind a wrapper that may strip it, the non-literal marker makes the hook refuse
    $repo = $envdrop && defined $envrepo ? ($envrepo =~ /^\$/ ? $envrepo : "\$:wrapper") : $envrepo unless defined $repo || $inline_empty;
    # A wrapper that may strip GH_REPO, and a GH_REPO that could be lost with it (the hook inherited one that no earlier segment dropped, or an
    # inline value stood in front of the wrapper) while nothing names the repository: gh may merge in origin or in that value, refused (#637).
    $repo = "\$:wrapper" if $envdrop && !defined $repo && !$inline_empty && ($lost || $inherited);
    # GH_REPO dropped (`unset`, `export -n`, an empty inline value) while the hook inherited one: gh uses origin, not the value the hook holds (#622).
    $repo = ":origin" if !defined $repo && ($dropped || $inline_empty) && length($ENV{GH_REPO} // "");
    return [($prefix =~ /(?:^|\s)E2E_GATE=full\s/ ? "1" : "0"), defined $repo ? $repo : "", $args];
  };
  my @found;
  # `(`, `)` and backticks split like `;` (subshell, `$(...)`, `out=$(...)`, `echo $(...)`; quoted ones were neutralised).
  # A segment in which that finds no merge is parsed once more whole, so `pulls/$(...)/merge` still reads as an unresolved
  # REST path.
  for my $coarse (split /&&|\|\||[;&|\n]/, $out) {
    my @fine = grep { defined } map { $track->($_, $coarse =~ /[()\x60]/); $parse->($_) } split /[()\x60]/, $coarse;
    if (@fine) { push @found, @fine; next }
    (my $whole = $coarse) =~ s/^\s*(?:(?:\$\(|[({!])\s*)*//;
    my $f = $parse->($whole);
    push @found, $f if $f;
  }
  print "multi" if @found > 1;
  print join("\n", @{$found[0]}) if @found == 1;
