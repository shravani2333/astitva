with open('database.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# The first instance ends at line 441 ("},")
# So we keep line 0 ("const astitva_db = [")
# And then from line 442 ("  {") onwards.

new_lines = [lines[0]] + lines[442:]
with open('database.js', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Deduplication complete by slice!")
