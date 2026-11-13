/* Facts about bit operations the SMT solvers lack bounds for (Alt-Ergo runs
   out of memory on them, Z3 and cvc5 give up). Both are admitted, not proved:
   OR of two non-negative integers is non-negative, and ACSL's shift on
   mathematical integers is multiplication by a power of two. */
/*@ admit lemma lor_nonneg: \forall integer a, b; 0 <= a && 0 <= b ==> 0 <= (a | b); */
/*@ admit lemma lsl_is_mul256: \forall integer x; (x << 8) == x * 256; */
