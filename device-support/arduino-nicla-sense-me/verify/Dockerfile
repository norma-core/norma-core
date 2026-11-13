# Frama-C 33 plus Z3 and cvc5: Alt-Ergo alone cannot discharge the goals that
# involve masks and shifts.
FROM framac/frama-c:33.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends z3 cvc5 && rm -rf /var/lib/apt/lists/*
USER opam
RUN /home/opam/.opam/4.14/bin/why3 config detect
