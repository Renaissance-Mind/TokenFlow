fn main() {
    println!(
        "cargo:rustc-env=TOKENFLOW_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build();
}
