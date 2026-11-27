# Vendored gremlin runtime

This directory contains the minimal gremlin.c runtime required by the
PWM output H7 firmware.

`gremlin.h` is header-only. `gremlin.c` exists only as a convenience
translation unit for build systems that expect a source file; it does
not provide external runtime symbols.
