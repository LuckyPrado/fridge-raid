import { ingredientLabel, money, packLabel } from "../../lib/sprites";
import type { WeekPlan } from "../../types";
import "./panels.css";

interface WeekPlanPanelProps {
  plan: WeekPlan;
  isSaving: boolean;
  onAccept: () => void;
  onRetry: () => void;
}

export function WeekPlanPanel({ plan, isSaving, onAccept, onRetry }: WeekPlanPanelProps) {
  if (plan.dishes.length === 0) {
    return (
      <section className="plan plan--empty" aria-label="Raid result">
        <h2 className="plan__title">The Rot survives</h2>
        <p>No dish passed the Nutritionist and fit a {money(plan.budget)} budget. Loosen a limit and raid again.</p>
        <button type="button" className="button button--light" onClick={onRetry}>
          Change the rules
        </button>
      </section>
    );
  }

  return (
    <section className="plan" aria-label="Raid result">
      <h2 className="plan__title">
        {plan.dishes.length} meals, {money(plan.waste_value_saved)} of food saved, {money(plan.total_cost)} to spend
      </h2>

      <ol className="plan__dishes">
        {plan.dishes.map((dish) => (
          <li key={dish.id}>
            <h3>{dish.name}</h3>
            <p>{dish.description}</p>
            <p className="plan__uses">
              {dish.ingredients
                .map((ingredient) => ingredientLabel(ingredient.quantity, ingredient.unit, ingredient.name))
                .join(", ")}
            </p>
          </li>
        ))}
      </ol>

      <div className="plan__cart">
        <h3>Shopping list</h3>
        {plan.cart.length === 0 ? (
          <p>Nothing to buy. Every ingredient is already in the fridge.</p>
        ) : (
          <table>
            <tbody>
              {plan.cart.map((line) => (
                <tr key={line.name}>
                  <th scope="row">{line.name}</th>
                  <td>{packLabel(line.packs, line.pack_size, line.unit, line.name)}</td>
                  <td className="plan__price">{money(line.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td>of a {money(plan.budget)} budget</td>
                <td className="plan__price">{money(plan.total_cost)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {plan.rescued.length > 0 ? <p className="plan__rescued">Saved from the bin: {plan.rescued.join(", ")}.</p> : null}
      </div>

      <div className="plan__actions">
        <button type="button" className="button button--raid" disabled={isSaving} onClick={onAccept}>
          {isSaving ? "Saving…" : "Accept plan and update fridge"}
        </button>
        <button type="button" className="button button--ghost-dark" disabled={isSaving} onClick={onRetry}>
          Discard and raid again
        </button>
      </div>
    </section>
  );
}
