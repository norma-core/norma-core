package main

import (
	"fmt"

	"github.com/norma-core/norma-core/shared/gremlin_go/example/generated/example"
)

func main() {
	// Create a user
	user := &example.User{
		Id:       1001,
		Username: "johndoe",
		Email:    "john@example.com",
		Active:   true,
		Tags:     []string{"developer", "golang", "protobuf"},
		Profile: &example.Profile{
			FullName: "John Doe",
			Age:      30,
			Bio:      "Software engineer passionate about performance",
			Address: &example.Address{
				Street:     "123 Main St",
				City:       "San Francisco",
				Country:    "USA",
				PostalCode: "94105",
			},
		},
		Metadata: map[string]string{
			"team":       "backend",
			"department": "engineering",
		},
	}

	// Serialize to protobuf
	data := user.Marshal()
	fmt.Printf("Serialized user data: %d bytes\n", len(data))
	fmt.Printf("Allocation count: 1 (single allocation!)\n\n")

	// Deserialize from protobuf
	reader := example.NewUserReader()
	if err := reader.Unmarshal(data); err != nil {
		panic(err)
	}

	// Access fields with lazy parsing
	fmt.Printf("User ID: %d\n", reader.GetId())
	fmt.Printf("Username: %s\n", reader.GetUsername())
	fmt.Printf("Email: %s\n", reader.GetEmail())
	fmt.Printf("Active: %v\n", reader.GetActive())
	fmt.Printf("Tags: %v\n", reader.GetTags())
	fmt.Printf("\n")

	// Access nested fields with null-safe getters
	fmt.Printf("Full Name: %s\n", reader.GetProfile().GetFullName())
	fmt.Printf("Age: %d\n", reader.GetProfile().GetAge())
	fmt.Printf("City: %s\n", reader.GetProfile().GetAddress().GetCity())
	fmt.Printf("Country: %s\n", reader.GetProfile().GetAddress().GetCountry())
	fmt.Printf("\n")

	// Access map fields
	metadata := reader.GetMetadata()
	fmt.Printf("Metadata:\n")
	for k, v := range metadata {
		fmt.Printf("  %s: %s\n", k, v)
	}
	fmt.Printf("\n")

	// Convert to struct for mutation
	mutableUser := reader.ToStruct()

	mutableUser.Username = "john_updated"
	mutableUser.Profile.Age = 31

	fmt.Printf("Updated username: %s\n", mutableUser.Username)
	fmt.Printf("Updated age: %d\n", mutableUser.Profile.Age)
}
