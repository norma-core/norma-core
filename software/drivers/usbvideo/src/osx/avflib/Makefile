# Makefile for avcameras library

CC = clang
LIBTOOL = libtool
MIN_MACOS = 13.0
CFLAGS = -c -mmacosx-version-min=$(MIN_MACOS) -Wunguarded-availability -Werror=unguarded-availability
FRAMEWORKS = -framework Foundation -framework AVFoundation -framework CoreMedia -framework CoreVideo
ARCH = -arch x86_64 -arch arm64

# Output directory
LIBDIR = lib
LIBNAME = libavf.a
OBJNAME = avf.o

# Source files
SOURCES = avflib/avf.m
HEADERS = avflib/avf.h

# Targets
all: $(LIBDIR)/$(LIBNAME)

$(LIBDIR)/$(LIBNAME): $(SOURCES) $(HEADERS)
	@mkdir -p $(LIBDIR)
	$(CC) $(CFLAGS) $(ARCH) -o $(LIBDIR)/$(OBJNAME) $(SOURCES)
	$(LIBTOOL) -static -o $@ $(LIBDIR)/$(OBJNAME)
	@rm -f $(LIBDIR)/$(OBJNAME)
	@echo "Built static library: $(LIBDIR)/$(LIBNAME)"

test: test_notifications.m
	@echo "Building notification test binary..."
	$(CC) -mmacosx-version-min=$(MIN_MACOS) $(FRAMEWORKS) -o test_notifications test_notifications.m
	@echo "Built: ./test_notifications"
	@echo "Run with: ./test_notifications"

test-lib: $(LIBDIR)/$(LIBNAME) test_library.m
	@echo "Building library test binary..."
	$(CC) -mmacosx-version-min=$(MIN_MACOS) $(FRAMEWORKS) -o test_library test_library.m -L$(LIBDIR) -lavf
	@echo "Built: ./test_library"
	@echo "Run with: ./test_library"

clean:
	rm -rf $(LIBDIR)
	rm -f test_notifications test_library

.PHONY: all clean test test-lib