{
  description = "WH3 Mod Manager binary release (x86_64 Linux)";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }: let
    system = "x86_64-linux";
    package = import ./default.nix { pkgs = import nixpkgs { inherit system; }; };
  in {
    packages.${system} = { default = package; wh3mm = package; };
    apps.${system}.default = { type = "app"; program = "${package}/bin/wh3mm"; };
  };
}
