"""Extract a verified npm archive without links, traversal or unbounded output."""
import pathlib
import sys
import tarfile

archive, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
strip_bundle = len(sys.argv) == 4 and sys.argv[3] == '--without-bundle'
with tarfile.open(archive) as tar:
    members = tar.getmembers()
    assert len(members) <= 30000, 'Too many archive members'
    assert sum(member.size for member in members) <= 128 * 1024 * 1024, 'Archive exceeds limit'
    names = {}
    root_name = None
    validated = []
    for member in members:
        name = member.name[2:] if member.name.startswith('./') else member.name
        name = name.rstrip('/') if member.isdir() else name
        if not name:
            assert member.isdir()
            continue
        parts = name.split('/')
        assert all(p and p != '..' for p in parts)
        parts = [p for p in parts if p != '.']
        name = '/'.join(parts)
        root_name = root_name or parts[0]
        assert parts[0] == root_name, 'Archive must have a single root'
        assert len(parts) > 1 or member.isdir(), 'Archive files must be inside the root'
        assert len(name) <= 1024 and '\\' not in name and not any(ord(c) < 32 for c in name)
        assert member.isfile() or member.isdir(), 'Archive links/special files are forbidden'
        if name in names:
            # Some upstream archives repeat package/./file and package/file.
            # Only identical regular bytes are equivalent; never overwrite data.
            previous = names[name]
            assert previous.isfile() and member.isfile(), 'Conflicting archive paths'
            assert previous.size == member.size and tar.extractfile(previous).read() == tar.extractfile(member).read(), 'Conflicting duplicate archive member'
            continue
        names[name] = member
        validated.append((member, parts[1:]))
    for member, parts in validated:
        if not parts or strip_bundle and parts[0] == 'node_modules':
            continue
        destination = target.joinpath(*parts)
        if member.isdir():
            destination.mkdir(parents=True, exist_ok=True)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as source, destination.open('xb') as output:
                output.write(source.read())
