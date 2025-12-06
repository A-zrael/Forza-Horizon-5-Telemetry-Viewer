package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	webDir := flag.String("web", "web", "directory containing index.html and assets")
	dataFile := flag.String("data", "web/data.json", "path to data.json produced by go run . > web/data.json")
	flag.Parse()

	absWeb, _ := filepath.Abs(*webDir)
	absData, _ := filepath.Abs(*dataFile)
	log.Printf("serving web dir: %s", absWeb)
	log.Printf("serving data file: %s", absData)

	// Serve the data file at /data.json
	http.HandleFunc("/data.json", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, absData)
	})

	// Fallback to static files
	fs := http.FileServer(http.Dir(absWeb))
	http.Handle("/", fs)

	fmt.Printf("Viewer running at http://localhost%s\n", *addr)
	if err := http.ListenAndServe(*addr, nil); err != nil {
		log.Fatal(err)
	}
}
