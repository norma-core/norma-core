package gremlin

import (
	"testing"
)

func TestDecodeInt64(t *testing.T) {
	var data = []byte{212, 1}

	buf := NewReader(data)
	if buf.ReadSInt64(0) != 106 {
		t.Errorf("Expected 106, got %d", buf.ReadSInt64(0))
	}
}

func TestVectorOfEnums(t *testing.T) {
	data := []byte{0xa0, 0x03, 0x00, 0x01, 0x02}

	buf := NewReader(data)
	offset := 0
	for buf.HasNext(offset, 0) {
		_, wire, tagSize, err := buf.ReadTagAt(offset)
		if err != nil {
			t.Fatalf("failed to read tag: %v", err)
		}

		offset += tagSize
		offset, err = buf.SkipData(offset, wire)
		if err != nil {
			t.Fatalf("failed to skip data: %v", err)
		}
	}
}
