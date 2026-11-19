# Plots In Markdown

## Figure directive - local

```{figure} #my-plot

My Caption
```

## Embed directive - local

```{embed} #my-plot
```

## Figure directive - external

```{figure} xref:guide#img:altair-horsepower

My Caption
```

## Embed directive - external

```{embed} xref:guide#img:altair-horsepower
```

## Figure directive - local, removed output

```{figure} #removed-plot

The output is removed from the notebook, and shown here
```
